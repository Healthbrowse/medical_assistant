import {build} from 'esbuild';
import {copyFile} from 'node:fs/promises';
await build({entryPoints:['client/file-parser.mjs'],outfile:'dist/file-parser.js',bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,legalComments:'inline'});
await copyFile('node_modules/pdfjs-dist/build/pdf.worker.min.mjs','dist/pdf-worker.js');
