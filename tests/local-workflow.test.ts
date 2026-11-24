import {test} from 'node:test';
import assert from 'node:assert/strict';
import {localTestDatabase,localDevelopmentDatabase} from '../scripts/local-command.js';
import {rejectedProviderTurns} from '../scripts/evaluation-checks.js';
test('local tests accept only a separate loopback PostgreSQL test database',()=>{
 for(const host of ['127.0.0.1','localhost','[::1]']){
  const value=`postgresql://local:private@${host}:55440/shopbot_local_test`;assert.equal(localTestDatabase(value),value);
 }
});
test('an empty final cart cannot pass when earlier provider turns were rejected',()=>{
 assert.deepEqual(rejectedProviderTurns([{message_id:'add',stage:'identify',state:'failed'},{message_id:'add',stage:'repair',state:'failed'},{message_id:'remove',stage:'identify',state:'succeeded'}]),['add']);
 assert.deepEqual(rejectedProviderTurns([{message_id:'add',stage:'identify',state:'failed'},{message_id:'add',stage:'repair',state:'succeeded'}]),[]);
 assert.deepEqual(rejectedProviderTurns([{message_id:'voice',stage:'recognize',state:'succeeded'},{message_id:'voice',stage:'identify',state:'failed'}]),['voice']);
 assert.deepEqual(rejectedProviderTurns([]),[]);
});
test('local connected mode accepts only a separate local development database',()=>{
 const value='postgresql://local:private@127.0.0.1:55440/shopbot_dev';assert.equal(localDevelopmentDatabase(value),value);
 for(const value of ['postgresql://private@production.example/shopbot_dev','postgresql://private@127.0.0.1/shopbot_vps_preview','postgresql://private@localhost/shopbot_local_test'])assert.throws(()=>localDevelopmentDatabase(value),error=>error instanceof Error&&!error.message.includes('private'));
});
test('local test configuration rejects remote or normal development databases without exposing credentials',()=>{
 for(const value of [undefined,'invalid','postgresql://local:private@production.example/shopbot_local_test','postgresql://local:private@127.0.0.1/shopbot_dev','postgresql://local:private@127.0.0.1/shopbot_vps_preview','https://local:private@localhost/shopbot_local_test']){
  assert.throws(()=>localTestDatabase(value),error=>error instanceof Error&&/TEST_DATABASE_URL/.test(error.message)&&!error.message.includes('private'));
 }
});
