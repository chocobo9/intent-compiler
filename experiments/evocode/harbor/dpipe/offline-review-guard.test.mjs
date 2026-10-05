import test from 'node:test';
import assert from 'node:assert/strict';
import {createCallBudget,addSessionRejections} from './offline-review-guard.mjs';
const empty={origin:'coding_session_review',findings:[]};
const finding={dimension:'D1',claim:'missing',expected:'required text',observed:'not selected',refs:[{id:'t',revision:0,digest:'sha256:x'}]};
test('eighth reservation is allowed; ninth and subsequent calls stay rejected',()=>{
 const next=createCallBudget();for(let i=1;i<=8;i++)assert.equal(next(),i);
 assert.throws(next);assert.throws(next);
});
test('empty session review cannot turn model rejection or failure into success',()=>{
 for(const result of [{verdict:{verdict:'inconsistent',repair_target:'ir',findings:[finding]}},{error:{code:'schema'}}])assert.equal(addSessionRejections(result,empty),result);
});
test('added rejection preserves original raw call and findings and does not mutate model result',()=>{
 const original={verdict:{verdict:'inconsistent',repair_target:'ir',findings:[finding]},call:{text:'original',usage:{input_tokens:1}}};
 const result=addSessionRejections(original,{...empty,repair_target:'ci',findings:[finding]});
 assert.equal(result.verdict.repair_target,'ir');assert.equal(result.verdict.findings.length,2);
 assert.equal(original.verdict.findings.length,1);assert.equal(result.call,original.call);
});
test('unsupported review origin, missing evidence and absent model verdict fail closed',()=>{
 assert.throws(()=>addSessionRejections({}, {...empty,origin:'model'}));
 assert.throws(()=>addSessionRejections({}, {...empty,repair_target:'ir',findings:[finding]}));
 assert.throws(()=>addSessionRejections({verdict:{verdict:'consistent',findings:[]}}, {...empty,repair_target:'ir',findings:[{...finding,refs:[]}]}));
});
