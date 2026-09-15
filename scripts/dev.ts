import {spawn} from 'node:child_process';
await import('./build');
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(process.execPath.includes('bun')?'node':'node',['node_modules/electron/cli.js','.'],{env,stdio:'inherit',shell:false});
child.on('exit',code=>process.exit(code??1));
