import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const root=process.cwd();
const server=http.createServer(async(req,res)=>{
 try { const file=path.resolve(root, '.'+new URL(req.url,'http://local').pathname); if(!file.startsWith(root+path.sep)) throw Error(); res.setHeader('content-type','text/javascript'); res.end(await readFile(file)); }
 catch {res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage();
 await page.goto(`http://127.0.0.1:${server.address().port}/card/pet-feeder-card.js`);
 const result=await page.evaluate(async()=>{
  const {PetFeederCard}=await import('/card/pet-feeder-card.js');
  const editor=await PetFeederCard.getConfigElement(); document.body.append(editor);
  const original={type:'custom:pet-feeder-card',model:'aqara_c1',unknown:{nested:[1]},entities:{status:'sensor.original'}};
  const events=[]; editor.addEventListener('config-changed',e=>events.push({config:e.detail.config,bubbles:e.bubbles,composed:e.composed}));
  editor.setConfig(original);
  const registry={
   'config_entries/get':[{entry_id:'a',domain:'petsafe_freshfeed'}],
   'config/device_registry/list':[{id:'d',config_entry_id:'a',name:'Kitchen'},{id:'foreign',config_entry_id:'other',name:'Other'}],
   'config/entity_registry/list':['schedule','write_status','quick_feed','history'].map((k,i)=>({device_id:'d',config_entry_id:'a',platform:'petsafe_freshfeed',unique_id:`a_${k}`,translation_key:k,entity_id:`sensor.renamed_${i}`,disabled_by:null}))
  };
  let commands=0; editor.hass={callWS:async({type})=>registry[type],callService:()=>commands++};
  await new Promise(r=>setTimeout(r,20));
  const before=events.length;
  const picker=editor.shadowRoot.querySelector('[data-device]');
  const options=[...picker.options].map(o=>o.value);
  picker.value='d'; picker.dispatchEvent(new Event('change'));
  const selected=events.at(-1);
  const labels=[...editor.shadowRoot.querySelectorAll('input,select,textarea')].every(e=>e.labels?.length || e.getAttribute('aria-label'));
  const name=editor.shadowRoot.querySelector('[data-field="name"]'); name.value='New name'; name.dispatchEvent(new Event('change'));
  const count=events.length;
  editor.hass={callWS:async()=>{throw Error('denied');}};
  await new Promise(r=>setTimeout(r,20));
  const fallback=editor.shadowRoot.textContent.includes('manual');
  // An earlier permission request must not replace a newer successful request.
  let release; const gate=new Promise(r=>release=r);
  editor.hass={callWS:async()=>{await gate; throw Error('old denial');}};
  editor.hass={callWS:async({type})=>registry[type]};
  await new Promise(r=>setTimeout(r,20)); release(); await new Promise(r=>setTimeout(r,20));
  const staleSafe=editor.shadowRoot.querySelector('[data-device]').options.length===2;
  const change=(key,value)=>{const el=editor.shadowRoot.querySelector(`[data-field="${key}"]`); el.value=value; el.dispatchEvent(new Event('change'));};
  const initial=events.length;
  change('mode','raw');
  const invalidNotEmitted=events.length===initial && editor.shadowRoot.textContent.includes('resets incompatible');
  change('raw_entities','["sensor.raw"]');
  const raw=events.at(-1).config;
  const visibleReset=editor.shadowRoot.querySelector('[data-field="entities"]').value==='';
  change('footer','["invalid"]');
  editor.setConfig({model:'aqara_c1',name:'Replacement'});
  change('name','After replacement');
  const pendingCleared=events.at(-1).config.name==='After replacement';
  return {before,options,selected,labels,count,fallback,staleSafe,commands,original,invalidNotEmitted,raw,visibleReset,pendingCleared};
 });
 assert.equal(result.before,0); assert.deepEqual(result.options,['','d']);
 assert.equal(result.selected.config.freshfeed.schedule_entity,'sensor.renamed_0');
 assert.equal(result.selected.bubbles,true); assert.equal(result.selected.composed,true);
 assert.equal(result.labels,true); assert.equal(result.count,2); assert.equal(result.commands,0);
 assert.equal(result.fallback,true); assert.equal(result.staleSafe,true);
 assert.equal(result.invalidNotEmitted,true); assert.equal(result.raw.mode,'raw'); assert.deepEqual(result.raw.raw_entities,['sensor.raw']);
 assert.equal(result.raw.freshfeed,undefined); assert.equal(result.visibleReset,true); assert.equal(result.pendingCleared,true);
 assert.deepEqual(result.original,{type:'custom:pet-feeder-card',model:'aqara_c1',unknown:{nested:[1]},entities:{status:'sensor.original'}});
 const second=await page.evaluate(async()=>{
  const {PetFeederCard}=await import('/card/pet-feeder-card.js');
  const tick=()=>new Promise(r=>setTimeout(r,20));
  const keys=['schedule','write_status','quick_feed','history'];
  const registry={
   'config_entries/get':[{entry_id:'a',domain:'petsafe_freshfeed'}],
   'config/device_registry/list':[{id:'d',config_entry_id:'a',name:'Kitchen'}],
   'config/entity_registry/list':keys.map((k,i)=>({device_id:'d',config_entry_id:'a',platform:'petsafe_freshfeed',unique_id:`a_${k}`,translation_key:k,entity_id:`sensor.renamed_${i}`}))
  };
  const bound={entry_id:'a',schedule_entity:'sensor.renamed_0',write_status_entity:'sensor.renamed_1',quick_feed_entity:'sensor.renamed_2',history_entity:'sensor.renamed_3'};
  const editor=await PetFeederCard.getConfigElement(); document.body.append(editor);
  const events=[]; editor.addEventListener('config-changed',e=>events.push(e.detail.config));
  const original={model:'freshfeed',freshfeed:bound,entities:{status:'sensor.custom_status'},actions:[{action:'petsafe_freshfeed.command',data:{operation:'feed'}}]};
  editor.setConfig(original);
  let calls=0; let release; const gate=new Promise(r=>release=r);
  const connection={};
  editor.hass={connection,callWS:async({type})=>{calls++; await gate; return registry[type];}};
  const name=editor.shadowRoot.querySelector('[data-field="name"]'); name.focus(); name.value='typing';
  release(); await tick();
  const draftSurvivesLoad=editor.shadowRoot.querySelector('[data-field="name"]')===name && name.value==='typing' && editor.shadowRoot.activeElement===name;
  const loadCalls=calls;
  editor.hass={connection,callWS:async({type})=>{calls++; return registry[type];}};
  await tick();
  const noRoutineReload=calls===loadCalls && editor.shadowRoot.querySelector('[data-field="name"]')===name && name.value==='typing';
  name.value=''; // discard the uncommitted draft before testing selection
  const picker=editor.shadowRoot.querySelector('[data-device]'); picker.value='d'; picker.dispatchEvent(new Event('change'));
  const sameFeeder=events.at(-1);
  editor.setConfig(sameFeeder);
  const entry=editor.shadowRoot.querySelector('[data-semantic="entry_id"]');
  const before=events.length;
  entry.value='b'; entry.dispatchEvent(new Event('change'));
  const noMixedEmit=events.length===before && [...editor.shadowRoot.querySelectorAll('[data-semantic]')].filter(e=>e.dataset.semantic!=='entry_id').every(e=>e.value==='') && editor.shadowRoot.querySelector('[data-field="entities"]').value==='';
  for(const key of ['schedule_entity','write_status_entity','quick_feed_entity','history_entity']) {
   const input=editor.shadowRoot.querySelector(`[data-semantic="${key}"]`); input.value=`sensor.b_${key}`; input.dispatchEvent(new Event('change'));
  }
  const rebound=events.at(-1);
  return {draftSurvivesLoad,noRoutineReload,loadCalls,sameFeeder,noMixedEmit,rebound,emitted:events.length-before};
 });
 assert.equal(second.draftSurvivesLoad,true); assert.equal(second.noRoutineReload,true); assert.equal(second.loadCalls,3);
 assert.deepEqual(second.sameFeeder.entities,{status:'sensor.custom_status'}); assert.deepEqual(second.sameFeeder.actions,[{action:'petsafe_freshfeed.command',data:{operation:'feed'}}]);
 assert.equal(second.noMixedEmit,true); assert.equal(second.emitted,1);
 assert.deepEqual(second.rebound.freshfeed,{entry_id:'b',schedule_entity:'sensor.b_schedule_entity',write_status_entity:'sensor.b_write_status_entity',quick_feed_entity:'sensor.b_quick_feed_entity',history_entity:'sensor.b_history_entity'});
 assert.equal(Object.hasOwn(second.rebound,'entities'),false); assert.deepEqual(second.rebound.actions,[]);
 const polish=await page.evaluate(async()=>{
  const {PetFeederCard}=await import('/card/pet-feeder-card.js');
  const editor=await PetFeederCard.getConfigElement(); document.body.append(editor);
  const events=[]; editor.addEventListener('config-changed',e=>events.push(e.detail.config));
  editor.setConfig({model:'aqara_c1',name:'Old',meal_slots:3});
  const field=key=>editor.shadowRoot.querySelector(`[data-field="${key}"]`);
  const defaultColor=field('color').value;
  field('color').focus(); field('color').value='black'; field('color').dispatchEvent(new Event('change'));
  const focused=editor.shadowRoot.activeElement===field('color'); const color=events.at(-1).color;
  field('meal_slots').value=''; field('meal_slots').dispatchEvent(new Event('change'));
  const slotsRemoved=!Object.hasOwn(events.at(-1),'meal_slots');
  field('name').value=''; field('name').dispatchEvent(new Event('change'));
  return {defaultColor,focused,color,slotsRemoved,nameRemoved:!Object.hasOwn(events.at(-1),'name')};
 });
 assert.deepEqual(polish,{defaultColor:'white',focused:true,color:'black',slotsRemoved:true,nameRemoved:true});
 console.log('PASS editor browser: renamed picker, labels, immutable single events, manual denial, stale responses, no commands, draft-preserving hass updates, same-feeder round trip, manual entry rebinding');
} finally {await browser.close(); await new Promise(r=>server.close(r));}
