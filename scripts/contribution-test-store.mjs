// Isolated TEST DATA transport to real Redis Lua. No production credentials.
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
const b64=v=>typeof v==='string'?Buffer.from(v).toString('base64'):Array.isArray(v)?v.map(b64):v;
createServer(async(req,res)=>{
 let body='';for await(const part of req)body+=part;
 try {const commands=JSON.parse(body);const batch=req.url.includes('pipeline')||req.url.includes('multi-exec');const results=[];
 for(const c of batch?commands:[commands]){const {stdout}=await exec('docker',['exec','favour-response-redis-20261007','redis-cli','--json',...c.map(String)]);const result=JSON.parse(stdout.trim());results.push({result:req.headers['upstash-encoding']==='base64'?b64(result):result});}
 res.setHeader('Content-Type','application/json');res.end(JSON.stringify(batch?results:results[0]));
 }catch(e){res.statusCode=500;res.end(JSON.stringify({error:e.message}));}
}).listen(8087,'127.0.0.1',()=>console.log('TEST DATA real Redis transport http://127.0.0.1:8087'));
