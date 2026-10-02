import {spawnSync} from 'node:child_process';
// Build mode must not inherit NODE_ENV=development from a local preview environment.
for(const args of [['node_modules/typescript/bin/tsc','-b'],['node_modules/vite/bin/vite.js','build']]){
 const result=spawnSync(process.execPath,args,{stdio:'inherit',env:{...process.env,NODE_ENV:'production'}});
 if(result.status!==0)process.exit(result.status||1);
}
await import('./build-sw.js');
