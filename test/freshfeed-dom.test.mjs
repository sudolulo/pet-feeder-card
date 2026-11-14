import test from 'node:test';
import assert from 'node:assert/strict';
import { PetFeederCard, validateConfig } from '../card/pet-feeder-card.js';

const config = () => ({model:'freshfeed',entities:{},freshfeed:{entry_id:'entry',schedule_entity:'s',write_status_entity:'w',quick_feed_entity:'q',history_entity:'h'}});
class Element {
  constructor(tag='div') { this.tagName=tag; this.children=[]; this.dataset={}; this.listeners={}; this.attributes={}; this.classList={add(){},remove(){}}; this.disabled=false; this.hidden=false; this.value=''; this.checked=false; this.textContent=''; this.isConnected=true; }
  set innerHTML(value) { this._html=value; }
  get innerHTML() { return this._html || ''; }
  appendChild(node) { this.children.push(node); return node; }
  append(...nodes) { nodes.forEach(node=>this.appendChild(node)); }
  replaceChildren(...nodes) { this.children=[...nodes]; }
  setAttribute(key,value) { this.attributes[key]=String(value); if(key==='data-recovery-message') this.dataset.recoveryMessage=''; }
  getAttribute(key) { return this.attributes[key] ?? null; }
  addEventListener(type,fn) { (this.listeners[type]??=[]).push(fn); }
  async click() { if (!this.disabled && !this.hidden) for(const fn of this.listeners.click||[]) await fn({target:this,preventDefault(){}}); }
  async emit(type) { for(const fn of this.listeners[type]||[]) await fn({target:this,preventDefault(){}}); }
  querySelector(selector) {
    const match = (node) => selector.startsWith('[') ? (() => { const key=selector.slice(1,-1).split('=')[0]; const dataKey=key.startsWith('data-')?key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase()):key; return dataKey in node.dataset || key in node.attributes; })() : node.tagName===selector;
    const stack=[...this.children]; while(stack.length){const node=stack.shift();if(match(node))return node;stack.unshift(...node.children);} return null;
  }
}
const originalDocument=globalThis.document;
const originalConfirm=globalThis.confirm;
function setup(){
  globalThis.document={createElement:(tag)=>new Element(tag),createTextNode:(text)=>({textContent:text,children:[]})};
  const card=new PetFeederCard(); card._config=validateConfig(config()); card._render=()=>{};
  const section=new Element('section'); const editor=new Element();const actions=new Element();const recovery=new Element();const history=new Element();const freshness=new Element('p'),message=new Element('p'),writeStatus=new Element('p');
  section.querySelector=(s)=>({'[data-editor]':editor,'[data-actions]':actions,'[data-recovery]':recovery,'[data-history]':history,'[data-freshness]':freshness,'[data-message]':message,'[data-write-status]':writeStatus}[s]||actions.querySelector(s));
  card._dialog={freshfeed:{section,draft:null,error:null},el:new Element()};
  card._hass={config:{time_zone:'UTC'},states:{s:{state:'unknown',attributes:{source_state:'unknown',entries:null,revision:null}},w:{state:'idle',attributes:{can_feed:true,can_defrost:true,can_refilled:true,recovery_phase:'idle'}},q:{state:'idle',attributes:{status:'idle',minutes:null}},h:{state:'0',attributes:{events:[],basis:'ha_observed'}}},callService:async()=>{}};
  return {card,section,editor,actions,recovery,history,freshness,message,writeStatus};
}
test.afterEach(()=>{globalThis.document=originalDocument;globalThis.confirm=originalConfirm;});

test('unknown schedule stays unavailable until a device report arrives',()=>{
  const {card,message,editor}=setup(); card._updateFreshfeedStatus();
  assert.match(message.textContent,/unavailable/); assert.equal(editor.children.length,0);
});
test('last-known schedule shows last-seen and permits editing without confirmation',()=>{
  const {card,freshness}=setup(); card._hass.states.s={state:'1',attributes:{source_state:'last_known',observed_at:'2026-11-12T00:00:00Z',entries:[{weekmask:127,hour:7,minute:0,enabled:true,audible:false}],revision:'rev'}};
  card._updateFreshfeedStatus(); assert.match(freshness.textContent,/last seen/); assert.ok(card._dialog.freshfeed.draft);
});
test('history is escaped text, preserves rows across unrelated updates, and changes when data changes',()=>{
  const {card,history}=setup();const events=[{kind:'dispensed',at:'2026-11-12T08:00:00Z',source_dp:145,compartment:2}];
  card._hass.states.h={state:'1',attributes:{events,basis:'ha_observed'}};card._updateFreshfeedStatus();
  const row=history.children[1];assert.match(row.textContent,/(DP145|DP145-derived local event)/);assert.strictEqual(row.children.length,0);
  card._hass.states.other={state:'on',attributes:{}};card.hass=card._hass;assert.strictEqual(history.children[1],row);
  card._hass.states.h.attributes.events=[];card._updateFreshfeedStatus();assert.match(history.children[1].textContent,/No HA-observed events/);
});
test('history labels provenance-less persisted events as HA-observed local observations',()=>{
  const {card,history}=setup();card._hass.states.h={state:'2',attributes:{events:[{kind:'dispensed',at:'2026-11-12T08:00:00Z',source_dp:null},{kind:'skipped_empty',at:'2026-11-12T09:00:00Z',source_dp:null}]}};
  card._updateFreshfeedStatus();const rows=history.children.map(row=>row.textContent);assert.ok(rows.some(text=>/HA-observed DP145-derived local event/.test(text)));assert.ok(rows.some(text=>/HA-observed DP14-derived local event/.test(text)));
});
test('history empty and unsupported DP151 are explicit',()=>{
  const {card,history}=setup();card._updateFreshfeedStatus();assert.match(history.children[1].textContent,/No HA-observed events/);assert.match(history.children.at(-1).textContent,/DP151.*unsupported/);
});
test('recovery phase updates preserve draft and button identity across hass updates',()=>{
  const {card,recovery}=setup();card._hass.states.s={state:'1',attributes:{source_state:'current',entries:[{weekmask:127,hour:7,minute:0,enabled:true,audible:false}],revision:'rev'}};
  card._hass.states.w={state:'uncertain',attributes:{operation_id:'op',session_id:'session',recovery_can_start:true,recovery_phase:'awaiting_user_confirmation'}};
  card._updateFreshfeedStatus();const draft=card._dialog.freshfeed.draft;
  const button=recovery.querySelector('[data-recover]');
  card._updateFreshfeedStatus();assert.strictEqual(recovery.querySelector('[data-recover]'),button);assert.strictEqual(card._dialog.freshfeed.draft,draft);assert.equal(button.hidden,false);
  card._hass.states.w.attributes.recovery_phase='collecting';card._updateFreshfeedStatus();assert.match(recovery.querySelector('[data-recovery-message]').textContent,/Waiting for device reports/);assert.equal(button.hidden,true);
});
test('invalid or absent browser history times are rendered as text',()=>{
  const {card,history}=setup();card._hass.states.h={state:'5',attributes:{events:[{kind:'feed <unsafe>',at:'not-a-date',source_dp:14},{kind:'null',at:null},{kind:'missing'},{kind:'empty',at:''},{kind:'non-string',at:0}]}};card._updateFreshfeedStatus();
  for(const row of history.children.slice(1,6)){assert.match(row.textContent,/Unknown time/);assert.equal(row.children.length,0);}
});

function editable() {
  const ctx=setup();
  ctx.card._hass.states.s={state:'1',attributes:{source_state:'current',revision:'rev',entries:[{weekmask:127,hour:7,minute:0,enabled:true,audible:false}]}};
  ctx.card._updateFreshfeedStatus();
  return ctx;
}
const button=(parent,text)=>parent.children.find(node=>node.textContent===text);

test('DOM edits weekdays, time and flags into the exact save vector',async()=>{
  const {card,editor,actions}=editable(); const calls=[];
  card._hass.callService=async(...args)=>calls.push(args);
  const field=editor.children[0];
  const time=field.children[1].children[0]; time.value='18:25'; await time.emit('input');
  for(const day of ['Sun','Tue','Sat']) await button(field,day).click();
  const enabled=field.children[9].children[0], audible=field.children[10].children[0];
  enabled.checked=false; await enabled.emit('change'); audible.checked=true; await audible.emit('change');
  await button(actions,'Add meal').click(); await button(actions,'Save').click();
  assert.deepEqual(calls,[['petsafe_freshfeed','save_schedule',{entry_id:'entry',base_revision:'rev',entries:[{weekmask:92,hour:18,minute:25,enabled:false,audible:true},{weekmask:127,hour:8,minute:0,enabled:true,audible:true}]}]]);
});

test('deleting a selected row preserves duplicate disabled meals and order',async()=>{
  const {card,editor,actions}=editable(); const calls=[];
  const duplicate={weekmask:64,hour:9,minute:15,enabled:false,audible:false};
  const last={weekmask:1,hour:20,minute:30,enabled:true,audible:true};
  card._hass.states.s.attributes.entries=[duplicate,{weekmask:127,hour:12,minute:0,enabled:true,audible:false},duplicate,last];
  card._dialog.freshfeed.draft=null; card._updateFreshfeedStatus(); card._hass.callService=async(...args)=>calls.push(args);
  await button(editor.children[1],'Delete').click(); await button(actions,'Save').click();
  assert.deepEqual(calls[0][2].entries,[duplicate,duplicate,last]);
});

test('Add meal stops at ten rows',async()=>{
  const {editor,actions}=editable();
  for(let i=1;i<10;i++) await button(actions,'Add meal').click();
  assert.equal(editor.children.length,10); assert.equal(button(actions,'Add meal').disabled,true);
  await button(actions,'Add meal').click(); assert.equal(editor.children.length,10);
});

test('all weekday buttons map to their wire bits',async()=>{
  const {card,editor,actions}=editable(); const calls=[]; card._hass.callService=async(...args)=>calls.push(args);
  const field=editor.children[0];
  for(const day of ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']) await button(field,day).click();
  assert.equal(button(actions,'Save').disabled,true);
  await button(field,'Mon').click(); await button(actions,'Save').click();
  assert.equal(calls[0][2].entries[0].weekmask,64);
});

test('save rejection retains edits and displays an error',async()=>{
  const {card,editor,actions,message}=editable();
  const time=editor.children[0].children[1].children[0]; time.value='09:30'; await time.emit('input');
  card._hass.callService=async()=>{throw new Error('private');}; await button(actions,'Save').click();
  assert.match(message.textContent,/rejected.*edits were retained/i); assert.equal(time.value,'09:30');
  assert.equal(button(actions,'Save').disabled,false);
});

test('incoming revision conflicts preserve edits and cancel reloads device vector',async()=>{
  const {card,editor,actions,message}=editable(); const calls=[]; card._hass.callService=async(...args)=>calls.push(args);
  const time=editor.children[0].children[1].children[0]; time.value='09:30'; await time.emit('input');
  card._hass.states.s.attributes.revision='new'; card._hass.states.s.attributes.entries[0].hour=12; card._updateFreshfeedStatus();
  assert.equal(time.value,'09:30'); assert.match(message.textContent,/changed on the device/i); assert.equal(button(actions,'Save').disabled,true);
  await button(actions,'Save').click(); assert.equal(calls.length,0); await button(actions,'Cancel').click();
  assert.equal(editor.children[0].children[1].children[0].value,'12:00'); assert.equal(button(actions,'Save').disabled,false); assert.equal(calls.length,0);
});

test('pending save latches duplicate clicks even after editor rerender',async()=>{
  const {card,actions}=editable(); let resolve; const calls=[];
  card._hass.callService=(...args)=>{calls.push(args);return new Promise(r=>resolve=r);};
  const first=button(actions,'Save').click(); card._renderScheduleEditor(); await button(actions,'Save').click();
  assert.equal(calls.length,1); assert.equal(button(actions,'Save').disabled,true); resolve(); await first;
});

test('server pending disables save and reports submission without verification',async()=>{
  const {card,actions,writeStatus}=editable(); let calls=0; card._hass.callService=async()=>calls++;
  card._hass.states.w.state='pending'; card._updateFreshfeedStatus();
  assert.equal(button(actions,'Save').disabled,true); assert.match(writeStatus.textContent,/not yet verified/);
  await button(actions,'Save').click(); assert.equal(calls,0);
});

test('raw mode prevents schedule and recovery service dispatch',async()=>{
  const {card,actions,recovery}=editable(); let calls=0; card._hass.callService=async()=>calls++; card._config.mode='raw';
  await button(actions,'Save').click();
  card._hass.states.w={state:'uncertain',attributes:{operation_id:'op',session_id:'session',recovery_can_start:true,recovery_phase:'awaiting_user_confirmation'}};
  card._updateFreshfeedStatus(); globalThis.confirm=()=>true; await recovery.querySelector('[data-recover]').click(); assert.equal(calls,0);
});

test('recovery phases expose only eligible actions and no physical success claim',()=>{
  const {card,recovery}=editable(); const attrs={operation:'feed',operation_id:'op',session_id:'session',recovery_can_start:true};
  card._hass.states.w={state:'uncertain',attributes:attrs};
  for(const [phase,visible,pattern] of [['idle',false,/^$/],['awaiting_user_confirmation',true,/restart/],['collecting',false,/Waiting for device reports.*35/],['resolved',false,/does not confirm physical success/],['failed',true,/awaiting_device_report/]]) {
    attrs.recovery_phase=phase; attrs.reason=phase==='failed'?'awaiting_device_report':null; card._updateFreshfeedStatus();
    assert.equal(!recovery.querySelector('[data-recover]').hidden,visible,phase); assert.match(recovery.querySelector('[data-recovery-message]').textContent,pattern);
  }
  attrs.storage_fault=true; card._updateFreshfeedStatus(); assert.equal(recovery.querySelector('[data-recover]').hidden,true);
});

test('declined or rejected recovery retains uncertainty',async()=>{
  const {card,recovery,message,writeStatus}=editable();
  card._hass.states.w={state:'uncertain',attributes:{operation_id:'op',session_id:'session',recovery_can_start:true,recovery_phase:'awaiting_user_confirmation'}};
  card._updateFreshfeedStatus(); let calls=0; globalThis.confirm=()=>false; card._hass.callService=async()=>{calls++;throw Error('private');};
  const recover=recovery.querySelector('[data-recover]'); await recover.click(); assert.equal(calls,0);
  globalThis.confirm=()=>true; await recover.click(); assert.equal(calls,1); assert.match(message.textContent,/Recovery request rejected/);
  assert.match(writeStatus.textContent,/uncertain/i); assert.equal(recover.hidden,false);
});

test('zero-report recovery retries only on a second confirmation and resolves without resending',async()=>{
  const {card,recovery}=editable(); const attrs={operation:'feed',operation_id:'op',session_id:'session',recovery_can_start:true,recovery_phase:'awaiting_user_confirmation'};
  card._hass.states.w={state:'uncertain',attributes:attrs}; card._updateFreshfeedStatus(); const calls=[]; let confirms=0;
  let resolve; globalThis.confirm=()=>{confirms++;return true;}; card._hass.callService=(...args)=>{calls.push(args);return new Promise(r=>resolve=r);};
  const recover=recovery.querySelector('[data-recover]'); const first=recover.click(); await recover.click();
  assert.equal(confirms,1); assert.equal(calls.length,1);
  attrs.recovery_phase='collecting'; card._updateFreshfeedStatus(); resolve(); await first; await recover.click(); assert.equal(calls.length,1);
  attrs.recovery_phase='failed'; attrs.reason='awaiting_device_report'; card._updateFreshfeedStatus();
  assert.match(recovery.querySelector('[data-recovery-message]').textContent,/awaiting_device_report/); assert.equal(calls.length,1);
  const second=recover.click(); await recover.click(); assert.equal(confirms,2); assert.equal(calls.length,2);
  assert.deepEqual(calls[0],['petsafe_freshfeed','recover',{entry_id:'entry',operation_id:'op',session_id:'session',confirmed:true}]); assert.deepEqual(calls[1],calls[0]);
  attrs.recovery_phase='collecting'; card._updateFreshfeedStatus(); resolve(); await second; attrs.recovery_phase='resolved'; card._updateFreshfeedStatus(); await recover.click();
  assert.equal(confirms,2); assert.equal(calls.length,2); assert.equal(recover.hidden,true);
});

test('recovery confirms once and latches duplicate clicks through collection',async()=>{
  const {card,recovery}=editable(); const attrs={operation:'feed',operation_id:'op',session_id:'session',recovery_can_start:true,recovery_phase:'awaiting_user_confirmation'};
  card._hass.states.w={state:'uncertain',attributes:attrs}; card._updateFreshfeedStatus(); let confirms=0,resolve; const calls=[];
  globalThis.confirm=()=>{confirms++;return true;}; card._hass.callService=(...args)=>{calls.push(args);return new Promise(r=>resolve=r);};
  const recover=recovery.querySelector('[data-recover]'); const pending=recover.click(); await recover.click();
  assert.equal(confirms,1); assert.deepEqual(calls,[['petsafe_freshfeed','recover',{entry_id:'entry',operation_id:'op',session_id:'session',confirmed:true}]]);
  attrs.recovery_phase='collecting'; card._updateFreshfeedStatus(); resolve(); await pending;
  attrs.recovery_phase='resolved'; card._updateFreshfeedStatus(); assert.equal(confirms,1); assert.equal(recover.hidden,true);
});
