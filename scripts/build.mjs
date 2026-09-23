import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('web/dist', {recursive: true});
await build({entryPoints:['web/src/app.js'],bundle:true,minify:true,format:'esm',target:['es2022'],outdir:'web/dist',logLevel:'info'});
await copyFile('web/index.html','web/dist/index.html');
