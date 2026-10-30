import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type Raw = { sampleRateHz:number; channels:number; sampleFormat:string; endianness:string; byteOffset:number; layout:"interleaved"|"planar" };
type Chunk = { startSec:number; sampleRateHz:number; samples:number[] };
type Bounds = { start:number; end:number; loop:boolean };
type NodeState = { source:AudioBufferSourceNode; from:number; at:number; rate:number };

export function useReadOnlyPlayback(onPosition:(position:number|null)=>void,onFailure:(error:string)=>void) {
  const [playing,setPlaying]=useState(false);
  const [loop,setLoop]=useState(false);
  const [position,setPosition]=useState<number|null>(null);
  const context=useRef<AudioContext|null>(null);
  const node=useRef<NodeState|null>(null);
  const token=useRef(0);
  const current=useRef(0);
  const active=useRef(false);
  const positionCallback=useRef(onPosition);
  const errorCallback=useRef(onFailure);
  positionCallback.current=onPosition;errorCallback.current=onFailure;
  function cursorPosition() {
    if(node.current && context.current) {
      const playingSec=Math.max(0,context.current.currentTime-node.current.at);
      return node.current.from+Math.min(playingSec,node.current.source.buffer!.duration);
    }
    return current.current;
  }
  function pause() {
    current.current=cursorPosition();
    token.current++;
    active.current=false;
    node.current?.source.stop();
    node.current=null;
    setPlaying(false);
    setPosition(current.current);
    positionCallback.current(current.current);
  }
  function stop() {
    token.current++;
    active.current=false;
    try{node.current?.source.stop();}catch { /* already ended */ }
    node.current=null;
    current.current=0;
    setPlaying(false);
    setPosition(null);
    positionCallback.current(null);
  }
  async function enqueue(id:number,path:string,raw:Raw|null,channel:number,
                         at:number,bounds:Bounds):Promise<void>{
    if (token.current!==id || !active.current) return;
    if(at>=bounds.end-0.0001) {
      if(bounds.loop) at=bounds.start;
      else {stop();return;}
    }
    const length=Math.min(1.5,bounds.end-at);
    if(length<=0) {stop();return;}
    const chunk=await invoke<Chunk>("audio_chunk",{
      path,rawSpec:raw,channelIndex:channel,startSec:at,durationSec:length
    });
    if(id!==token.current || !active.current) return;
    if(!chunk.samples.length){stop();return;}
    const ctx=context.current!;
    const audioBuffer=ctx.createBuffer(1,chunk.samples.length,chunk.sampleRateHz);
    audioBuffer.copyToChannel(Float32Array.from(chunk.samples),0);
    const source=ctx.createBufferSource();
    source.buffer=audioBuffer;
    source.connect(ctx.destination);
    node.current={source,from:at,at:ctx.currentTime,rate:chunk.sampleRateHz};
    current.current=at;
    source.onended=()=>{
      if(id!==token.current || !active.current) return;
      node.current=null;
      current.current=at+chunk.samples.length/chunk.sampleRateHz;
      void enqueue(id,path,raw,channel,current.current,bounds)
        .catch(e=>{ if(id===token.current){stop();errorCallback.current(String(e));} });
    };
    source.start();
  }
  async function toggle(path:string|null,raw:Raw|null,channel:number,
                        cursor:number,duration:number,selection:{start:number;end:number}|null) {
    if(active.current){pause();return;}
    if(!path)return;
    try{
      const ctx=context.current ?? new AudioContext();
      context.current=ctx;
      await ctx.resume();
      const end=Math.max(0,duration);
      const selected=selection&&Math.abs(selection.end-selection.start)>0
        ? {start:Math.min(selection.start,selection.end),end:Math.max(selection.start,selection.end)} : null;
      const bounds:Bounds=loop&&selected ? {...selected,loop:true}:{start:0,end,loop:false};
      const from=bounds.loop ? bounds.start :
        (current.current>0 && current.current<end ? current.current : Math.min(Math.max(cursor,0),end-0.001));
      const id=++token.current;
      active.current=true;setPlaying(true);
      await enqueue(id,path,raw,channel,from,bounds);
    }catch(e){stop();errorCallback.current("Playback failed: "+String(e));}
  }
  useEffect(()=>{
    const handle=window.setInterval(()=>{
      if(!active.current)return;
      const pos=cursorPosition();
      setPosition(pos);
      positionCallback.current(pos);
    },80);
    return ()=>{window.clearInterval(handle);token.current++;active.current=false;
      try{node.current?.source.stop();}catch { /* ended */ }
      void context.current?.close();};
  },[]);
  return {playing,loop,setLoop,position,toggle,pause,stop};
}
