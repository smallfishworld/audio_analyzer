// Reproducible app icon generator. No external graphics dependencies needed.
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { join } from "node:path";
const dir = new URL("../src-tauri/icons/", import.meta.url);
mkdirSync(dir, { recursive: true });
function crc32(buf) {
  let crc = -1;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ -1) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type);
  const size = Buffer.alloc(4); size.writeUInt32BE(data.length, 0);
  const sum = Buffer.alloc(4); sum.writeUInt32BE(crc32(Buffer.concat([name,data])),0);
  return Buffer.concat([size,name,data,sum]);
}
function png(size) {
  const lines=[];
  for(let y=0;y<size;y++){
    const row=Buffer.alloc(1+size*4);row[0]=0;
    for(let x=0;x<size;x++){
      const cx=x-size/2,cy=y-size/2;
      const rounded=Math.abs(cx)<size*.40 && Math.abs(cy)<size*.40;
      const wave=Math.sin(x/size*Math.PI*3)*size*.12;
      const signal=Math.abs(cy-wave)<size*.047 && Math.abs(cx)<size*.35;
      const k=1+4*x;
      row[k]=rounded?(signal?38:22):9;
      row[k+1]=rounded?(signal?217:37):16;
      row[k+2]=rounded?(signal?229:59):27;
      row[k+3]=255;
    }
    lines.push(row);
  }
  const header=Buffer.alloc(13); header.writeUInt32BE(size,0);header.writeUInt32BE(size,4);header[8]=8;header[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",header),chunk("IDAT",deflateSync(Buffer.concat(lines),{level:9})),chunk("IEND",Buffer.alloc(0))]);
}
const p32=png(32),p128=png(128);
writeFileSync(new URL("32x32.png",dir),p32);writeFileSync(new URL("128x128.png",dir),p128);
const ico=Buffer.alloc(22);ico.writeUInt16LE(1,2);ico.writeUInt16LE(1,4);ico[6]=32;ico[7]=32;ico.writeUInt16LE(1,10);ico.writeUInt16LE(32,12);ico.writeUInt32LE(p32.length,14);ico.writeUInt32LE(22,18);
writeFileSync(new URL("icon.ico",dir),Buffer.concat([ico,p32]));
console.log("Generated Audio Analyzer icons");
