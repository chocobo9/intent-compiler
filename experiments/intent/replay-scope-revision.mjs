// Development regression: original prior state and input, real model proposal.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createCompilerModel } from '../../dist/model/compiler-model.js';
import { createOpenCodeModelTransport } from '../../dist/model/opencode-transport.js';
import { applyProposal, projectCompiledIntent } from '../../dist/core/intent-state.js';
const original = 'D:/huawei/intent-single-coding-001';
const executorOnly = process.argv.includes('--executor-only');
const base = 'D:/huawei/intent-single-coding-fix-002/exact-prior-state';
const root = executorOnly ? `${base}/executor-retry` : base;
mkdirSync(root);
const save = (name, value) => writeFileSync(`${root}/${name}`, typeof value === 'string' ? value : JSON.stringify(value, null, 2), {flag:'wx'});
const history = readFileSync(`${original}/compiler-store/runs/single-coding-001/history.jsonl`, 'utf8').trim().split('\n').map(JSON.parse);
const prior = history.find(e => e.type === 'commit.complete' && e.data.inputIdentity.endsWith('turn-2')).data.state;
const old = history.find(e => e.type === 'proposal.saved' && e.data.inputIdentity.endsWith('turn-3')).data.proposal.proposal;
const input = readFileSync(`${original}/inputs/user-3.txt`, 'utf8');
const harness = readFileSync(`${original}/inputs/harness.txt`, 'utf8');
const directory = 'D:\\huawei\\intent-single-coding-fix-002\\compiler-model';
const headers = {'Content-Type':'application/json'};
if (process.env.OPENCODE_SERVER_PASSWORD) headers.Authorization = 'Basic ' + Buffer.from(`${process.env.OPENCODE_SERVER_USERNAME ?? 'opencode'}:${process.env.OPENCODE_SERVER_PASSWORD}`).toString('base64');
async function http(method, path, body) {
  const response = await fetch(`http://127.0.0.1:4199${path}?directory=${encodeURIComponent(directory)}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(path === '/config' ? 5000 : 180000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}
const server = spawn('C:/Program Files/nodejs/node_modules/opencode-ai/bin/opencode.exe', ['serve','--hostname','127.0.0.1','--port','4199'], {cwd:directory,windowsHide:true,stdio:'ignore'});
try {
  let config;
  for(let attempt=0;attempt<40;attempt++) {
    try {config=await http('GET','/config');break;} catch {await new Promise(r=>setTimeout(r,250));}
  }
  if(config?.provider?.openai?.models?.['gpt-5.6-luna-fast']?.options?.reasoningEffort !== 'max') throw new Error('Missing max configuration');
  let projected;
  let result;
  if (executorOnly) {
    projected = JSON.parse(readFileSync(`${base}/projection.json`, 'utf8'));
  } else {
  const transport = createOpenCodeModelTransport({directory, providerId:'openai', modelId:'gpt-5.6-luna-fast', client:{session:{
    create: async ({body}) => ({data:await http('POST','/session',body)}),
    prompt: async ({path,body}) => {save('compiler-http-request.json',body); const result=await http('POST',`/session/${path.id}/message`,body);save('compiler-http-response.json',result);return {data:result};},
  }}});
  save('prior-state.json', prior);
  save('user-input.txt',input);
  result=await createCompilerModel(transport).propose({base_state_version:prior.state_version,current_state:prior,input_identity:old.input_identity,input_digest:old.input_digest,input_text:input,admitted_evidence:[]});
  save('model-result.json',result);
  if(!result.ok) throw new Error('Model proposal rejected');
  const applied=applyProposal(prior,result.proposal,{input_identity:old.input_identity,input_digest:old.input_digest,text:input});
  save('applied.json',applied);
  if(!applied.ok) throw new Error('Reducer rejected proposal');
  projected=projectCompiledIntent(applied.state);
  save('projection.json',projected);
  }
  const session=await http('POST','/session',{title:'scope revision regression executor',permission:[{permission:'*',pattern:'*',action:'deny'}]});
  const request={model:{providerID:'openai',modelID:'gpt-5.6-luna-fast'},agent:'build',variant:'max',system:harness,tools:{'*':false},parts:[{type:'text',text:projected.rendered_text}]};
  save('executor-request.json',request);
  const answer=await http('POST',`/session/${session.id}/message`,request);
  save('executor-response.json',answer);
  if(answer.info?.error || answer.parts.some(p=>p.type==='tool'||p.type==='subtask')) throw new Error('Executor error or tools');
  console.log(JSON.stringify({operations:result?.proposal.operations,answer:answer.parts.filter(p=>p.type==='text').map(p=>p.text).join('\n')}));
} finally {server.kill();}
