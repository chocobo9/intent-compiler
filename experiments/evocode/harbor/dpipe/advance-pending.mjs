// Process the pending executor-return batch only. No new input, executor, or verifier.
// The original store is copied by the launcher; all mutations below are local.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { createCallBudget } from './offline-review-guard.mjs';
const root = process.env.OFFLINE_ROOT ?? '/opt/offline';
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const write = (p, x) => fs.writeFileSync(p, JSON.stringify(x, null, 2) + '\n');
const cfg = read(path.join(root, 'run.json'));
// Continuations preserve historical accounting; each preparation batch gets
// only its separately authorized new allowance.
const historyCalls = cfg.history_management_calls ?? 10;
const totalLimit = cfg.max_total_management_requests;
const evidence = path.join(root, 'calls'); fs.mkdirSync(evidence, {recursive:true});
const load = file => import(pathToFileURL(path.join(cfg.runtime, 'dist', file)).href);
const { IntentStoreV2 } = await load('core/compiler-store-v2.js');
const { createIntentCompilerV2 } = await load('core/intent-compiler-v2.js');
const { createCompilerModelV2 } = await load('model/compiler-model-v2.js');
const { createOpenCodeModelTransportV2, createOpenCodeCheckTransportV2 } = await load('model/opencode-transport.js');
const { createOpencodeClient } = await import(pathToFileURL(cfg.sdk_client).href);
const sdk = createOpencodeClient({baseUrl:cfg.server});
let active;
let count = 0;
const reserve = createCallBudget(8);
const client = { session: {
  create: async req => {
    const response = await sdk.session.create(req);
    write(path.join(evidence, `${active}-session.json`), response);
    return response;
  },
  prompt: async req => {
    // Persist the actual transport envelope, including schema and system.
    const {signal, ...record} = req;
    write(path.join(evidence, `${active}-wire-request.json`), record);
    const result = await sdk.session.prompt(req);
    write(path.join(evidence, `${active}-host-response.json`), result);
    return result;
  },
  abort: req => sdk.session.abort(req),
}};
const transportOptions = {client, directory:path.join(root,'model'), providerId:'openai', modelId:'gpt-6-luna-fast', variant:'high-fast', agent:'build', timeoutMs:900000};
function measured(stage, transport) {
  return async (input, generation) => {
    count = reserve(); active = String(count).padStart(2,'0');
    const id = active;
    write(path.join(root,'progress.json'), {status:'calling',new_calls_reserved:count,stage:input.generation_stage??stage,at:new Date().toISOString()});
    write(path.join(evidence, `${id}-stage-input.json`), {stage:input.generation_stage??stage,input,generation});
    const started = new Date().toISOString();
    try {
      const result = await transport(input,generation);
      write(path.join(evidence,`${id}-transport-result.json`), result);
      write(path.join(evidence,`${id}-timing.json`), {started_at:started,completed_at:new Date().toISOString(),stage:input.generation_stage??stage,usage:result.usage});
      return result;
    } catch(error) {
      write(path.join(evidence,`${id}-error.json`), {started_at:started,completed_at:new Date().toISOString(),name:error.name,message:error.message,diagnostic:error.diagnostic});
      throw error;
    }
  };
}
const rawModel = createCompilerModelV2(
  measured('propose',createOpenCodeModelTransportV2(transportOptions)),
  measured('check',createOpenCodeCheckTransportV2(transportOptions)),
);
// Independent model check runs inline; no session-review wait, no injected findings.
const model = {
  ...rawModel,
  verify: async input => {
    const result = await rawModel.verify(input);
    write(path.join(evidence,`${active}-parsed-model-check.json`),result);
    return result;
  },
};
const lock = path.join(root,'generation-started.lock');
fs.writeFileSync(lock,new Date().toISOString(),{flag:'wx'});
const store = new IntentStoreV2({storeDir:path.join(root,'compiler-store'),runId:cfg.parent_run_id});
const baseline = store.current();
assert.equal(baseline.budget.total_management_requests,historyCalls);
assert.equal(baseline.budget.max_total_management_requests,totalLimit);
assert.equal(baseline.budget.max_management_requests,8);
assert.deepEqual(baseline.pending_event_ids,[cfg.pending_event_id]);
assert.equal(baseline.unresolved_user_event_ids.length,0);
const compiler = createIntentCompilerV2({store,model,capabilities:{
  operations:cfg.operations,workspace_root:'/app',
  describeMaterial:paths=>paths.map(p=>({path:p,exists:fs.existsSync(p),readable_by_executor:fs.existsSync(p)})),
}});
const batchStarted = new Date().toISOString();
try {
  // Exactly one batch over the already queued return event. No automatic reopen.
  const result=await compiler.advance({runId:cfg.parent_run_id});
  const final=store.current();
  assert.equal(final.executions.length,baseline.executions.length,'No executor may start');
  assert.equal(final.dispatches.length,baseline.dispatches.length,'Return batch must not dispatch');
  assert.equal(final.execution_outcomes.length,baseline.execution_outcomes.length,'No fabricated return');
  assert(final.budget.total_management_requests<=totalLimit);
  write(path.join(root,'advance-result.json'),result);
  if(result.ok) {
    const artifacts=path.join(root,'artifacts');fs.mkdirSync(artifacts,{recursive:true});
    write(path.join(artifacts,'ir.json'),final.ir);
    write(path.join(artifacts,'compiled.json'),final.compiled);
    write(path.join(artifacts,'atoms.json'),(result.deliveries??[]).map(x=>x.atom));
    write(path.join(artifacts,'status.json'),{kind:'offline_preparation',semantic_review:'not_performed',actually_delivered:false,executor_started:false,proposed_deliveries:result.deliveries?.length??0});
  }
  write(path.join(root,'progress.json'),{status:'finished',ok:result.ok,semantic_review:'not_performed',new_calls_reserved:count,batch_started_at:batchStarted,batch_completed_at:new Date().toISOString(),new_management_calls:final.management_calls.slice(historyCalls)});
} catch(error) {
  write(path.join(root,'progress.json'),{status:'failed',new_calls_reserved:count,batch_started_at:batchStarted,batch_completed_at:new Date().toISOString(),error:{name:error.name,message:error.message,stack:error.stack}});
  process.exitCode=1;
}
