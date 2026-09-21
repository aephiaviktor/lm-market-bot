'use strict';
// Run only during separately authorized testing. No app, task or installer is launched.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const yaml=require('js-yaml');
const root=path.resolve(process.argv[2]||'.');
const file='LM-Market-Bot-MUD-Setup-0.3.3-test.4.exe';
const bytes=fs.readFileSync(path.join(root,file));
const hash=crypto.createHash('sha512').update(bytes).digest('base64');
const metadata=Buffer.from(yaml.dump({version:'0.3.3-test.4',files:[{url:file,sha512:hash,size:bytes.length}],path:file,sha512:hash}));
const allowed=new Map([['/mud.yml',metadata],[`/${file}`,bytes],[`/${file}.blockmap`,fs.readFileSync(path.join(root,file+'.blockmap'))]]);
http.createServer((req,res)=>{
 const data=allowed.get(new URL(req.url,'http://127.0.0.1:18765').pathname);
 if(!['GET','HEAD'].includes(req.method)||!data){res.writeHead(404);res.end();return;}
 res.writeHead(200,{'Content-Length':data.length,'Cache-Control':'no-store'});
 res.end(req.method==='HEAD'?undefined:data);
}).listen(18765,'127.0.0.1',()=>console.log('MUD TEST ONLY feed listening on 127.0.0.1:18765; Ctrl+C stops it.'));
