import { it } from 'vitest';
import { PROFILES } from '../../lib/dsp/profiles';
import { encodeTextToAudioBuffer, bytesToSymbols } from '../../lib/dsp/modulation';
import { serializePacket, chunkText, BARKER_13_BITS } from '../../lib/dsp/framing';
import { Demodulator } from '../../lib/dsp/demodulation';
import { GoertzelFilterBank as G } from '../../lib/dsp/goertzel';

it('diagnostic clean balanced transmission (temporary)', () => {
 const text='UltraLink 2026', p=PROFILES.balanced, sr=48000;
 const pcm=encodeTextToAudioBuffer(text,p,sr,101);
 const packet=chunkText(text,p,101)[0], enc=bytesToSymbols(serializePacket(packet),p);
 const chirp=Math.round(p.chirpDurationMs/1000*sr);
 const chip=Math.round(.005*sr);
 const actualStart=chirp+chip*13+Math.round(.01*sr);
 const b=new G(p.dataFrequencies,sr);
 let mismatch=0;
 let example=[];
 for(let i=0;i<enc.length;i++){
  const v=b.evaluate(pcm,actualStart+i*Math.round(p.symbolDurationMs/1000*sr)+Math.round(p.activeDurationMs/1000*sr*.15),Math.round(p.activeDurationMs/1000*sr*.7)).peakIndex;
  if(v!==enc[i]){mismatch++;if(example.length<12)example.push([i,enc[i],v]);}
 }
 console.log('DIAG actual', {pcm:pcm.length,chirp,chip,actualStart,numSymbols:enc.length,mismatch,example});
 const f0=p.pilotFrequencies[0],f1=p.pilotFrequencies[1];
 function score(start:number){let n=0;for(let i=0;i<13;i++){
   const s=start+i*chip;
   const a=G.computeSingleFrequencyPower(f0,pcm,sr,s,chip),b=G.computeSingleFrequencyPower(f1,pcm,sr,s,chip);
   if(BARKER_13_BITS[i]===1?b>a:a>b)n++;
 }return n;}
 let first11:number|null=null,best=0,bestAt=0;
 for(let i=0;i<chirp+chip*13;i+=Math.floor(chip/3)){
  const sc=score(i); if(sc>=11 && first11===null)first11=i;
  if(sc>best){best=sc;bestAt=i;}
 }
 const afc=b.refinePeakFrequency(pcm,f1,50,chirp,chip)-f1;
 console.log('DIAG sync',{scoreActual:score(chirp),first11,best,bestAt,afc});
 const syncs:any[]=[]; const crcs:any[]=[];
 const d=new Demodulator({profile:p,sampleRate:sr},{onSyncDetected:(confidence,carrierOffsetHz)=>syncs.push([confidence,carrierOffsetHz]),onCrcError:(a,b)=>crcs.push([a,b])});
 const res=d.decodeBuffer(pcm);
 console.log('DIAG decoded',{packets:res.packets.length,messages:res.messages.length,syncs:syncs.slice(0,20),numSyncs:syncs.length,crcs:crcs.slice(0,20)});
});