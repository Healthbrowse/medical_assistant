// The managed preview supplies its port as a CLI option; production uses PORT.
import {parseArgs} from 'node:util';
const {values}=parseArgs({options:{port:{type:'string'},host:{type:'string'},strictPort:{type:'boolean'}}});
if(values.port){
  const port=Number(values.port);
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid development port');
  process.env.PORT=String(port);
}
await import('../server/main.mjs');
