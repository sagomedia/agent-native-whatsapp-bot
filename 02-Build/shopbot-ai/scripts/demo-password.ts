import {hashDemoPassword} from '../apps/server/src/http/owner-demo-login.js';
// Read from stdin so passwords never appear in process arguments or shell history.
const chunks:Buffer[]=[];for await(const chunk of process.stdin){chunks.push(Buffer.from(chunk));if(chunks.reduce((n,b)=>n+b.length,0)>1024)throw Error('Password input too long.');}
const password=Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/,'');console.log(await hashDemoPassword(password));
