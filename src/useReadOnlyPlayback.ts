import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type Raw = { sampleRateHz:number; channels:number; sampleFormat:string; endianness:string; byteOffset:number; layout:"interleaved"|"planar" };
type Chunk = { startSec:number; sampleRateHz:number; samples:number[] };
type Bounds = {start:number;end:number;loop:boolean};
type Scheduled = {source:AudioBufferSourceNode;from:number;startAt:number;length:number};
type Session = {
  id:number;path:string;raw:Raw|null;channel:number;bounds:Bounds;
  nextPosition:number;nextWhen:number;finished:boolean;
};

/** Two-second look-ahead queue prevents a decode/IPC gap after every audio chunk. */
export function useReadOnlyPlayback(onPosition:(t:number|null)=>void,onFailure:(error:string)=>void) {
  const [playing,setPlaying]=useState(false);
  const [loop,setLoop]=useState(false);
  const [position,setPosition]=useState<number|null>(null);
  const context=useRef<AudioContext|null>(null);
  const scheduled=useRef<Scheduled[]>([]);
  const session=useRef<Session|null>(null);
  const serial=useRef(0);
  const filling=useRef(false);
  const pausePoint=useRef(0);
  const positionCallback=useRef(onPosition);
  const errorCallback=useRef(onFailure);
  positionCallback.current=onPosition;errorCallback.current=onFailure;

  function currentTimePosition() {
    const now=context.current?.currentTime??0;
    const list=scheduled.current;
    if (!list.length)return pausePoint.current;
    const active=list.find(x=>now>=x.startAt && now<x.startAt+x.length);
    if(active)return active.from+(now-active.startAt);
    if(now<list[0].startAt)return list[0].from;
    return list[list.length-1].from+list[list.length-1].length;
  }
  function cancelNodes() {
    for(const n of scheduled.current){try{n.source.stop();}catch{/* already ended */}}
    scheduled.current=[];
  }
  function pause() {
    if(!session.current)return;
    pausePoint.current=currentTimePosition();
    ++serial.current;session.current=null;
    cancelNodes();setPlaying(false);
    setPosition(pausePoint.current);positionCallback.current(pausePoint.current);
  }
  function stop() {
    ++serial.current;session.current=null;
    cancelNodes();pausePoint.current=0;
    setPlaying(false);setPosition(null);positionCallback.current(null);
  }
  async function fill() {
    const s=session.current,ctx=context.current;
    if(!s||!ctx||filling.current)return;
    filling.current=true;
    try {
      // Queue up to 2.5 seconds ahead; never decode or retain the whole file.
      for(let n=0;n<8 && session.current===s;n++) {
        if(s.nextWhen-ctx.currentTime>2.5 || s.finished)break;
        if(s.nextPosition>=s.bounds.end-0.0001) {
          if(s.bounds.loop)s.nextPosition=s.bounds.start;
          else {s.finished=true;break;}
        }
        const pos=s.nextPosition;
        const seconds=Math.min(1.5,s.bounds.end-pos);
        if(seconds<=0){s.finished=true;break;}
        const chunk=await invoke<Chunk>("audio_chunk",{
          path:s.path,rawSpec:s.raw,channelIndex:s.channel,
          startSec:pos,durationSec:seconds
        });
        if(session.current!==s || serial.current!==s.id)return;
        if(!chunk.samples.length){s.finished=true;break;}
        const length=chunk.samples.length/chunk.sampleRateHz;
        const buffer=ctx.createBuffer(1,chunk.samples.length,chunk.sampleRateHz);
        buffer.copyToChannel(Float32Array.from(chunk.samples),0);
        const source=ctx.createBufferSource();
        source.buffer=buffer;source.connect(ctx.destination);
        const startAt=Math.max(ctx.currentTime+0.04,s.nextWhen);
        scheduled.current.push({source,from:pos,startAt,length});
        source.onended=()=>{
          scheduled.current=scheduled.current.filter(x=>x.source!==source);
          if(session.current!==s)return;
          if(s.finished && !scheduled.current.length){stop();}
        };
        source.start(startAt);
        s.nextWhen=startAt+length;
        s.nextPosition=pos+length;
        // A short decode segment should not spin forever if FFmpeg ends early.
        if(length<seconds-0.01 && !s.bounds.loop){s.finished=true;break;}
      }
    }catch(e){
      if(session.current===s){stop();errorCallback.current("Playback failed: "+String(e));}
    }finally{filling.current=false;}
  }
  async function toggle(path:string|null,raw:Raw|null,channel:number,
                        cursor:number,duration:number,selection:{start:number;end:number}|null) {
    if(session.current){pause();return;}
    if(!path)return;
    try {
      const ctx=context.current??new AudioContext();
      context.current=ctx;
      await ctx.resume();
      const end=Math.max(0,duration);
      const selected=selection&&Math.abs(selection.end-selection.start)>0
        ? {start:Math.min(selection.start,selection.end),end:Math.max(selection.start,selection.end)}:null;
      const bounds:Bounds=loop&&selected?{...selected,loop:true}:{start:0,end,loop:false};
      const start=bounds.loop?bounds.start:
        pausePoint.current>0&&pausePoint.current<end?pausePoint.current:Math.min(Math.max(cursor,0),Math.max(0,end-0.001));
      if(start>=end)throw new Error("No audio frames remain at the cursor");
      const id=++serial.current;
      session.current={id,path,raw,channel,bounds,nextPosition:start,nextWhen:ctx.currentTime+0.04,finished:false};
      setPlaying(true);void fill();
    }catch(e){stop();errorCallback.current("Playback failed: "+String(e));}
  }
  useEffect(()=>{
    const timer=window.setInterval(()=>{
      if(!session.current)return;
      const pos=currentTimePosition();
      setPosition(pos);
      positionCallback.current(pos);
      void fill();
    },80);
    return ()=>{window.clearInterval(timer);++serial.current;session.current=null;
      cancelNodes();void context.current?.close();};
  },[]);
  return {playing,loop,setLoop,position,toggle,pause,stop};
}
