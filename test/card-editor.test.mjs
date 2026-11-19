import test from 'node:test';
import assert from 'node:assert/strict';
import {validateConfig, PetFeederCard} from '../dist/pet-feeder-card.js';
const load=()=>import('../dist/freshfeed-editor-model.js');
test('advanced_aqara_raw_configs_round_trip_without_mutation',async()=>{
 const {patchEditorConfig:patch}=await load();
 for(const config of [{model:'aqara_c1',entities:{status:'sensor.cat'},actions:[{action:'button.press',target:{entity_id:'button.cat'}}],unknown:{nested:[1]}},{model:'freshfeed',mode:'raw',raw_entities:['sensor.cat'],unknown:{nested:[2]}}]) {
  const before=structuredClone(config); const result=patch(config,{name:'New',color:'white'});
  assert.deepEqual(result,{...before,name:'New',color:'white'}); assert.deepEqual(config,before); validateConfig(result);
  result.unknown.nested.push(3); assert.deepEqual(config,before);
 }
});
test('changing_feeder_clears_only_entry_bound_actions_controls',async()=>{
 const {patchEditorConfig:patch}=await load();
 const freshfeed={entry_id:'a',schedule_entity:'sensor.s',write_status_entity:'sensor.w',quick_feed_entity:'sensor.q',history_entity:'sensor.h'};
 const original={model:'freshfeed',freshfeed,actions:[{action:'petsafe_freshfeed.command',data:{operation:'feed'}}],controls:['switch.old'],unknown:{nested:true}};
 assert.deepEqual(patch(original,{name:'New'}).actions,original.actions);
 const changed=patch(original,{freshfeed:{entry_id:'b',schedule_entity:'sensor.bs',write_status_entity:'sensor.bw',quick_feed_entity:'sensor.bq',history_entity:'sensor.bh'}});
 assert.deepEqual(changed.actions,[]); assert.deepEqual(changed.controls,[]); assert.deepEqual(changed.unknown,original.unknown); validateConfig(changed);
});
test('manual_entry_change_rejects_mixed_feeder_routes',async()=>{
 const {patchEditorConfig:patch}=await load();
 const freshfeed={entry_id:'a',schedule_entity:'sensor.s',write_status_entity:'sensor.w',quick_feed_entity:'sensor.q',history_entity:'sensor.h'};
 const original={model:'freshfeed',freshfeed,entities:{status:'sensor.a_status'}};
 assert.throws(()=>patch(original,{freshfeed:{...freshfeed,entry_id:'b'}}),/feeder/);
 assert.throws(()=>patch(original,{freshfeed:{...freshfeed,entry_id:'b',schedule_entity:'sensor.bs'}}),/feeder/);
 const next={entry_id:'b',schedule_entity:'sensor.bs',write_status_entity:'sensor.bw',quick_feed_entity:'sensor.bq',history_entity:'sensor.bh'};
 const changed=patch(original,{freshfeed:next});
 assert.equal(Object.hasOwn(changed,'entities'),false); validateConfig(changed);
 assert.deepEqual(patch(original,{freshfeed:next,entities:{status:'sensor.b_status'}}).entities,{status:'sensor.b_status'});
});
test('incompatible_mode_change_emits_only_valid_config',async()=>{
 const {patchEditorConfig:patch}=await load();
 assert.throws(()=>patch({model:'aqara_c1',entities:{status:'sensor.old'}},{model:'freshfeed',mode:'raw'}));
 const raw=patch({model:'aqara_c1',entities:{status:'sensor.old'},actions:[{action:'button.press'}]},{model:'freshfeed',mode:'raw',raw_entities:['sensor.raw']});
 validateConfig(raw); assert.equal(raw.entities,undefined); assert.equal(raw.actions,undefined);
 const standard=patch(raw,{model:'aqara_c1',mode:'standard'}); validateConfig(standard); assert.equal(standard.raw_entities,undefined);
});
test('runtime_exposes_lazy_editor_factory',()=>assert.equal(typeof PetFeederCard.getConfigElement,'function'));
