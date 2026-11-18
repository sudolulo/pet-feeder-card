import test from 'node:test';
import assert from 'node:assert/strict';
const load = () => import('../card/freshfeed-editor-model.js');
// Public HA 2026.10 list results are arrays; device rows use config_entry_id,
// entity rows expose platform, unique_id and translation_key (not state names).
export function registry() {
  const keys = ['schedule', 'write_status', 'quick_feed', 'history', 'meals_left'];
  return { configEntries: [{entry_id:'a', domain:'petsafe_freshfeed'}],
    devices:[{id:'d', config_entry_id:'a', identifiers:[['tuya_local','legacy']], name_by_user:'Kitchen'}],
    entities:keys.map((key,i)=>({id:`uuid${i}`,entity_id:`sensor.renamed_${i}`, device_id:'d', config_entry_id:'a', platform:'petsafe_freshfeed', unique_id:`a_${key}`, translation_key:key, disabled_by:null})) };
}
test('renamed_entities_bind_by_registry_not_name', async()=>{
 const {discoverFreshfeedBindings: discover}=await load();
 const {config,error}=discover(registry(),'d'); assert.equal(error,null);
 assert.deepEqual(config.freshfeed,{entry_id:'a',schedule_entity:'sensor.renamed_0',write_status_entity:'sensor.renamed_1',quick_feed_entity:'sensor.renamed_2',history_entity:'sensor.renamed_3'});
 assert.deepEqual(config.entities,{schedule:'sensor.renamed_0',meals_left:'sensor.renamed_4'});
 assert.equal(config.actions,undefined); assert.equal(config.controls,undefined);
});
test('source_owned_legacy_device_discovers_only_unambiguous_petsafe_entry',async()=>{
 const {discoverFreshfeedBindings: discover,freshfeedDevices}=await load();
 const r=registry();
 r.configEntries.push({entry_id:'source',domain:'tuya_local'});
 r.devices[0].config_entry_id='source';
 assert.deepEqual(freshfeedDevices(r).map(d=>d.id),['d']);
 assert.equal(discover(r,'d').config.freshfeed.entry_id,'a');
 r.configEntries.push({entry_id:'b',domain:'petsafe_freshfeed'});
 r.entities.push({...r.entities[0],id:'other',config_entry_id:'b',unique_id:'b_schedule'});
 assert.equal(discover(r,'d').config,null);
});
test('ambiguous_disabled_missing_or_foreign_rows_fail_closed',async()=>{
 const {discoverFreshfeedBindings: discover}=await load();
 for(const mutate of [r=>r.entities.push({...r.entities[0],entity_id:'sensor.duplicate'}),r=>r.entities[0].disabled_by='user',r=>r.entities.shift(),r=>r.entities[0].config_entry_id='foreign',r=>r.entities[0].platform='foreign',r=>r.entities[0].unique_id='foreign_schedule',r=>r.devices[0].disabled_by='user']) {
  const r=registry(); mutate(r); const out=discover(r,'d'); assert.equal(out.config,null); assert.match(out.error,/manual/i);
 }
 assert.equal(discover({},'d').config,null);
});
test('ambiguous_or_disabled_visible_entity_routes_fail_closed',async()=>{
 const {discoverFreshfeedBindings: discover}=await load();
 for(const mutate of [r=>r.entities.push({...r.entities[4],id:'dup',entity_id:'sensor.meals_duplicate'}),r=>r.entities[4].disabled_by='integration',r=>r.entities[4].entity_id='switch.meals_left']) {
  const r=registry(); mutate(r); const out=discover(r,'d'); assert.equal(out.config,null); assert.match(out.error,/manual/i);
 }
 const r=registry(); r.entities.pop(); assert.deepEqual(discover(r,'d').config.entities,{schedule:'sensor.renamed_0'});
});
test('first_binding_preserves_explicit_routes_and_actions',async()=>{
 const {discoverFreshfeedBindings: discover, bindDiscoveredFeeder: bind}=await load();
 const discovered=discover(registry(),'d').config;
 const current={model:'freshfeed',entities:{status:'sensor.custom'},actions:[{action:'petsafe_freshfeed.command',data:{operation:'feed'}}],controls:['switch.other']};
 const before=structuredClone(current); const result=bind(current,discovered);
 assert.deepEqual(result.entities,current.entities); assert.deepEqual(result.actions,current.actions); assert.deepEqual(result.controls,current.controls); assert.deepEqual(current,before);
 assert.throws(()=>bind({...current,actions:[{action:'button.press'}]},discovered),/parity actions/);
});
test('same_feeder_selection_preserves_explicit_routes',async()=>{
 const {discoverFreshfeedBindings: discover, bindDiscoveredFeeder: bind}=await load();
 const discovered=discover(registry(),'d').config;
 const current={model:'freshfeed',name:'Kitchen',freshfeed:{...discovered.freshfeed},entities:{status:'sensor.custom_status',schedule:'sensor.renamed_0'},actions:[{action:'petsafe_freshfeed.command',data:{operation:'feed'}}],unknown:{nested:[1]}};
 const before=structuredClone(current);
 const same=bind(current,discovered);
 assert.deepEqual(same,before); assert.deepEqual(current,before);
 const other={model:'freshfeed',freshfeed:{entry_id:'z',schedule_entity:'sensor.zs',write_status_entity:'sensor.zw',quick_feed_entity:'sensor.zq',history_entity:'sensor.zh'},entities:{status:'sensor.z_status'},actions:[{action:'petsafe_freshfeed.command',data:{operation:'feed'}}],controls:['switch.z']};
 const switched=bind(other,discovered);
 assert.deepEqual(switched.freshfeed,discovered.freshfeed); assert.deepEqual(switched.entities,discovered.entities);
 assert.deepEqual(switched.actions,[]); assert.deepEqual(switched.controls,[]);
});
