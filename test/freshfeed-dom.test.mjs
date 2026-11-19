import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const failureView = () => JSON.parse(readFileSync(new URL('./fixtures/cancel-observed-failure.json', import.meta.url), 'utf8'));
import { PetFeederCard, validateConfig } from '../dist/pet-feeder-card.js';

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
  const quickStatus=new Element('p'), quickTime=new Element('p'), cancelButton=new Element('button'), cancelMessage=new Element('p'), leadWarning=new Element('p');
  section.querySelector=(s)=>({'[data-quick-status]':quickStatus,'[data-quick-time]':quickTime,'[data-cancel-countdown]':cancelButton,'[data-cancel-message]':cancelMessage,'[data-editor]':editor,'[data-actions]':actions,'[data-recovery]':recovery,'[data-history]':history,'[data-freshness]':freshness,'[data-message]':message,'[data-write-status]':writeStatus,'[data-lead-time-warning]':leadWarning}[s]||actions.querySelector(s));
  card._dialog={freshfeed:{section,draft:null,error:null},el:new Element()};
  card._hass={config:{time_zone:'UTC'},states:{s:{state:'unknown',attributes:{source_state:'unknown',entries:null,revision:null}},w:{state:'idle',attributes:{can_feed:true,can_defrost:true,can_refilled:true,recovery_phase:'idle'}},q:{state:'idle',attributes:{status:'idle',minutes:null}},h:{state:'0',attributes:{events:[],basis:'ha_observed'}}},callService:async()=>{}};
  card._now=()=>new Date('2026-11-18T12:00:00Z');
  return {leadWarning,card,section,editor,actions,recovery,history,freshness,message,writeStatus,quickStatus,quickTime,cancelButton,cancelMessage};
}
test.afterEach(()=>{globalThis.document=originalDocument;globalThis.confirm=originalConfirm;});

test('opening schedule requests refresh and unavailable schedule can be retried', async()=>{
  const {card,section,actions}=setup(); const calls=[];
  card._hass.callService=async(...args)=>{calls.push(args); if(calls.length===1) throw Error('unavailable');};
  const create=globalThis.document.createElement;
  globalThis.document.createElement=(tag)=>tag==='section'?section:create(tag);
  card._dialog={el:new Element()};
  card._buildFreshfeed(new Element());
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(calls,[['homeassistant','update_entity',{entity_id:'s'}]]);
  assert.equal(card._dialog.freshfeed.draft,null);
  assert.equal(card._dialog.freshfeed.error,null);
  const retry=actions.children.find(node=>node.textContent==='Refresh schedule');
  assert.ok(retry);
  await retry.click();
  assert.deepEqual(calls,[['homeassistant','update_entity',{entity_id:'s'}],['homeassistant','update_entity',{entity_id:'s'}]]);
});

test('successful schedule refresh populates the open dialog with an editable cloud schedule', async()=>{
  const {card,section,editor,actions,message,freshness}=setup(); const calls=[];
  const create=globalThis.document.createElement;
  globalThis.document.createElement=(tag)=>tag==='section'?section:create(tag);
  card._hass.callService=async(...args)=>{calls.push(args);};
  card._dialog={el:new Element()};
  card._buildFreshfeed(new Element());
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(card._dialog.freshfeed.draft,null);
  assert.match(message.textContent,/Schedule unavailable/);
  const entries=[{weekmask:127,hour:7,minute:0,enabled:true,audible:false}];
  card.hass={...card._hass,states:{...card._hass.states,s:{state:'1',attributes:{source_state:'last_known',provenance:'cloud',revision:'cloud-rev',entries}}}};
  assert.equal(freshness.textContent,'Read from the PetSafe cloud');
  assert.equal(card._dialog.freshfeed.draft.baseRevision,'cloud-rev');
  assert.equal(editor.children.length,1);
  const time=editor.children[0].querySelector('input');
  assert.equal(time.value,'07:00');
  time.value='08:30'; await time.emit('input');
  assert.equal(button(actions,'Save').disabled,false);
  await button(actions,'Save').click();
  assert.deepEqual(calls,[['homeassistant','update_entity',{entity_id:'s'}],['petsafe_freshfeed','save_schedule',{entry_id:'entry',base_revision:'cloud-rev',entries:[{...entries[0],hour:8,minute:30}]}]]);
});

for (const mismatch of [null, 'operation', 'session', 'id', 'phase', 'barrier', 'fault', 'malformed']) {
  test(`abandonment releases only the matching cancel recovery: ${mismatch}`,()=>{
    const {card,cancelMessage,quickStatus,recovery}=setup();
    const latch={entryId:'entry',sessionId:'session',operationId:null,recovery:{operationId:'cancel-op',sessionId:'session'}};
    card._cancelLatch=latch;
    const resolution={operation_id:'cancel-op',session_id:'session',operation:'cancel',outcome:'abandoned'};
    const attrs={session_id:'session',operation_id:null,operation:null,recovery_phase:'resolved',recovery_resolution:resolution};
    if(mismatch==='operation') resolution.operation='feed';
    if(mismatch==='session') resolution.session_id='other';
    if(mismatch==='id') resolution.operation_id='other';
    if(mismatch==='phase') attrs.recovery_phase='failed';
    if(mismatch==='fault') attrs.storage_fault=true;
    if(mismatch==='malformed') attrs.recovery_resolution={};
    card._hass.states.w={state:mismatch==='barrier'?'uncertain':'idle',attributes:attrs};
    card._hass.states.q={state:'unknown',attributes:{}};
    card._updateFreshfeedStatus();
    assert.equal(card._entryCancelLatch()===null,mismatch===null);
    assert.equal(quickStatus.textContent,'Unknown');
    assert.equal(card._canFreshfeedAction('feed'),false);
    if(mismatch===null) {
      assert.equal(cancelMessage.textContent,'Local uncertainty cleared; execution unknown.');
      assert.equal(recovery.querySelector('[data-recovery-message]').textContent,'Local uncertainty cleared; execution unknown.');
    }
  });
}

for (const [resolution, quick, releases] of [
  ['observed_safe', 'idle', true],
  ['observed_safe', 'unknown', false],
  ['absent', 'idle', true],
  ['absent', 'unknown', false],
  ['absent', 'ready', false],
  ['malformed', 'idle', false],
]) {
  test(`resolved cancel latch: ${resolution} with ${quick}`,()=>{
    const {card,quickStatus}=setup();
    card._cancelLatch={entryId:'entry',sessionId:'session',operationId:null,recovery:{operationId:'cancel-op',sessionId:'session'}};
    const attrs={session_id:'session',operation_id:null,operation:null,recovery_phase:'resolved'};
    if(resolution==='observed_safe') attrs.recovery_resolution={operation_id:'cancel-op',session_id:'session',operation:'cancel',outcome:'observed_safe'};
    if(resolution==='malformed') attrs.recovery_resolution={};
    card._hass.states.w={state:'idle',attributes:attrs};
    card._hass.states.q={state:quick,attributes:{status:quick}};
    card._updateFreshfeedStatus();
    assert.equal(card._entryCancelLatch()===null,releases);
    if(quick==='unknown') assert.equal(quickStatus.textContent,'Unknown');
  });
}

test('corresponding backend terminal Cancel failure releases latch without claiming success or resending',async()=>{
  const {card,actions,cancelMessage,writeStatus}=editable(); let calls=0;
  card._hass.states.w={state:'idle',attributes:{can_cancel:true,session_id:'session'}};
  card._hass.states.q={state:'pending',attributes:{minutes:1}};
  card._hass.callService=async()=>calls++;
  card._updateFreshfeedStatus(); card._onCancelCountdown(); card._onCancelCountdown();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(button(actions,'Save').disabled,true);
  card._hass.states.w=failureView(); card._hass.states.q={state:'failed',attributes:{command:'cancel',minutes:0}};
  card._updateFreshfeedStatus();
  assert.equal(card._entryCancelLatch(),null);
  assert.match(cancelMessage.textContent,/Cancel failed.*device status observed/i);
  assert.equal(writeStatus.textContent,'');
  assert.equal(button(actions,'Save').disabled,false);
  assert.equal(card._canFreshfeedAction('feed'),true);
  assert.equal(card._canFreshfeedAction('defrost'),true);
  assert.equal(card._canFreshfeedAction('refilled'),false);
  card._hass.states.w.attributes.can_refilled=true; card._updateFreshfeedStatus();
  assert.equal(card._canFreshfeedAction('refilled'),true);
  const dialog=card._dialog; dialog.el.remove=()=>{}; card._closeControls(); card._dialog=dialog; card._updateFreshfeedStatus();
  assert.match(cancelMessage.textContent,/Cancel failed/); assert.equal(calls,1);
  card._hass.states.w.attributes.can_feed=false; card._updateFreshfeedStatus();
  assert.equal(card._canFreshfeedAction('feed'),false);
});

for (const mismatch of ['missing metadata','session','view session','operation','baseline failure','baseline operation','pending']) {
  test(`terminal failure cannot release Cancel on ${mismatch}`,async()=>{
    const {card,cancelMessage}=setup();
    card._hass.states.w=failureView();
    card._hass.states.w.attributes.can_cancel=true;
    if(mismatch==='baseline operation') card._hass.states.w.attributes.operation_id='new-cancel';
    card._hass.states.q={state:'pending',attributes:{minutes:1}};
    card._updateFreshfeedStatus(); card._onCancelCountdown(); card._onCancelCountdown();
    await new Promise(resolve=>setImmediate(resolve));
    const terminal=failureView(); terminal.attributes.observed_failure.operation_id='new-cancel';
    if(mismatch==='missing metadata') delete terminal.attributes.observed_failure;
    if(mismatch==='session') terminal.attributes.observed_failure.session_id='other';
    if(mismatch==='view session') terminal.attributes.session_id='other';
    if(mismatch==='operation') terminal.attributes.observed_failure.operation='feed';
    if(mismatch==='baseline failure') terminal.attributes.observed_failure.operation_id='cancel-op';
    if(mismatch==='pending') terminal.state='pending';
    card._hass.states.w=terminal; card._hass.states.q={state:'failed',attributes:{command:'cancel'}};
    card._updateFreshfeedStatus(); assert.ok(card._entryCancelLatch()); assert.equal(cancelMessage.textContent,'Submitted');
  });
}

test('cancel requires two taps and stays latched across stale updates',async()=>{
  const {card,cancelButton,quickStatus}=setup(); const calls=[];
  card._hass.states.w={state:'idle',attributes:{can_cancel:true,operation_id:'old',session_id:'session'}};
  card._hass.states.q={state:'pending',attributes:{minutes:0}}; card._hass.callService=async(...args)=>calls.push(args);
  card._updateFreshfeedStatus(); assert.match(quickStatus.textContent,/0 minutes; waiting for status/);
  card._onCancelCountdown(); assert.equal(calls.length,0); card._onCancelCountdown(); await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(calls,[['petsafe_freshfeed','command',{entry_id:'entry',operation:'cancel',confirmed:true}]]);
  card._updateFreshfeedStatus(); card._onCancelCountdown(); card._onCancelCountdown(); assert.equal(calls.length,1); assert.equal(cancelButton.disabled,true);
});

for (const ambiguousFailure of [false, true]) {
  test(`stale verified status does not certify latched Cancel (${ambiguousFailure ? 'uncertain' : 'submitted'})`,async()=>{
    const {card,writeStatus,cancelMessage}=setup();
    card._hass.states.w={state:'verified',attributes:{can_cancel:true,operation_id:'old',operation:'start',session_id:'session'}};
    card._hass.states.q={state:'pending',attributes:{minutes:2}};
    card._hass.callService=async()=>{if(ambiguousFailure) throw Error('connection lost');};
    card._updateFreshfeedStatus(); assert.equal(writeStatus.textContent,'Device status observed.');
    card._onCancelCountdown(); card._onCancelCountdown();
    await new Promise(resolve=>setImmediate(resolve));
    for(let update=0;update<2;update++) {
      card._hass.states.w={...card._hass.states.w,attributes:{...card._hass.states.w.attributes}};
      card._updateFreshfeedStatus();
      assert.equal(cancelMessage.textContent,ambiguousFailure ? 'Outcome uncertain' : 'Submitted');
      assert.doesNotMatch(writeStatus.textContent,/Device status observed/);
    }
    Object.assign(card._hass.states.w.attributes,{operation_id:'cancel-op',operation:'cancel'});
    card._hass.states.q={state:'idle',attributes:{command:'cancel'}};
    card._updateFreshfeedStatus();
    assert.equal(writeStatus.textContent,'Device status observed.');
    assert.equal(cancelMessage.textContent,'Device status observed');
  });
}

test('cancel disarms on eligibility loss and requires matching verified cancel idle',async()=>{
  const {card,cancelButton,cancelMessage}=setup(); const calls=[];
  const attrs={can_cancel:true,operation_id:'old',session_id:'session'};
  card._hass.states.w={state:'idle',attributes:attrs}; card._hass.states.q={state:'pending',attributes:{minutes:255}}; card._hass.callService=async(...args)=>calls.push(args);
  card._updateFreshfeedStatus(); card._onCancelCountdown(); attrs.can_cancel=false; card._updateFreshfeedStatus(); attrs.can_cancel=true; card._updateFreshfeedStatus();
  card._onCancelCountdown(); assert.equal(calls.length,0); card._onCancelCountdown(); await Promise.resolve(); await Promise.resolve();
  attrs.operation_id='new'; attrs.session_id='other'; attrs.operation='cancel'; card._hass.states.w.state='verified'; card._hass.states.q={state:'idle',attributes:{command:'cancel'}}; card._updateFreshfeedStatus(); assert.ok(card._cancelLatch);
  attrs.session_id='session'; card._hass.states.q.attributes.command='start'; card._updateFreshfeedStatus(); assert.ok(card._cancelLatch);
  card._hass.states.q.attributes.command='cancel'; card._updateFreshfeedStatus(); assert.equal(card._cancelLatch,null); assert.match(cancelMessage.textContent,/Device status observed/); assert.equal(cancelButton.hidden,true);
});

for (const change of ['operation', 'pending report', 'session', 'entry']) {
  test(`verified Cancel outcome is invalidated by a different ${change}`,async()=>{
    const {card,cancelMessage}=setup();
    const attrs={can_cancel:true,operation_id:'old',session_id:'session'};
    card._hass.states.w={state:'idle',attributes:attrs}; card._hass.states.q={state:'pending',attributes:{minutes:1}};
    card._updateFreshfeedStatus(); card._onCancelCountdown(); card._onCancelCountdown(); await new Promise(resolve=>setImmediate(resolve));
    Object.assign(attrs,{operation_id:'cancel-op',operation:'cancel'}); card._hass.states.w.state='verified';
    card._hass.states.q={state:'idle',attributes:{command:'cancel'}}; card._updateFreshfeedStatus();
    assert.match(cancelMessage.textContent,/Device status observed/);
    card._updateFreshfeedStatus(); assert.match(cancelMessage.textContent,/Device status observed/);
    if(change==='operation') attrs.operation_id='next-op';
    if(change==='pending report') card._hass.states.q={state:'pending',attributes:{command:'start',minutes:5}};
    if(change==='session') attrs.session_id='next-session';
    if(change==='entry') card._config.freshfeed.entry_id='other-entry';
    card._updateFreshfeedStatus(); assert.doesNotMatch(cancelMessage.textContent,/Device status observed/);
  });
}

test('unresolved Cancel outcome stays with its entry across an asynchronous failure',async()=>{
  const {card,cancelMessage}=setup(); let reject;
  card._hass.states.w={state:'idle',attributes:{can_cancel:true,session_id:'session'}};
  card._hass.states.q={state:'pending',attributes:{minutes:1}};
  card._hass.callService=()=>new Promise((resolve,rejectRequest)=>{reject=rejectRequest;});
  card._updateFreshfeedStatus(); card._onCancelCountdown(); card._onCancelCountdown();
  assert.equal(cancelMessage.textContent,'Submitted');
  card._config.freshfeed.entry_id='other-entry'; card._updateFreshfeedStatus();
  assert.equal(cancelMessage.textContent,'');
  reject(Error('connection lost')); await new Promise(resolve=>setImmediate(resolve));
  assert.equal(cancelMessage.textContent,'');
  card._config.freshfeed.entry_id='entry'; card._updateFreshfeedStatus();
  assert.equal(cancelMessage.textContent,'Outcome uncertain');
});

test('real HA service Cancel response releases only a proven rejection', {skip:!process.env.PETSAFE_CANCEL_SERVICE_RESULT}, async()=>{
  const {initial,response,safe}=JSON.parse(process.env.PETSAFE_CANCEL_SERVICE_RESULT);
  const {card,cancelMessage}=setup(); let calls=0;
  card._hass.states.w={state:initial.state,attributes:initial};
  card._hass.states.q={state:'pending',attributes:{minutes:1}};
  card._hass.callService=async()=>{calls++;if(!response.success) throw response.error;};
  card._updateFreshfeedStatus(); card._onCancelCountdown(); card._onCancelCountdown();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls,1);
  if(safe){
    assert.equal(card._entryCancelLatch(),null);
    assert.match(cancelMessage.textContent,/rejected/i);
    card._updateFreshfeedStatus(); // stale pending cannot silently replay
    assert.equal(calls,1);
    card._onCancelCountdown(); assert.equal(calls,1);
    card._onCancelCountdown(); await new Promise(resolve=>setImmediate(resolve));
    assert.equal(calls,2);
  }else{
    assert.ok(card._entryCancelLatch());
    card._updateFreshfeedStatus(); card._onCancelCountdown(); card._onCancelCountdown();
    await new Promise(resolve=>setImmediate(resolve)); assert.equal(calls,1);
  }
});

test('cancel rejection is visible and requires fresh confirmation',async()=>{
  const {card,cancelMessage}=setup(); let calls=0;
  card._hass.states.w={state:'idle',attributes:{can_cancel:true,session_id:'session'}}; card._hass.states.q={state:'pending',attributes:{minutes:1}};
  card._hass.callService=async()=>{calls++;throw {code:'service_validation_error'};}; card._updateFreshfeedStatus(); card._onCancelCountdown(); card._onCancelCountdown();
  await new Promise(resolve=>setImmediate(resolve)); assert.match(cancelMessage.textContent,/rejected/); card._onCancelCountdown(); assert.equal(calls,1); card._onCancelCountdown(); await new Promise(resolve=>setImmediate(resolve)); assert.equal(calls,2);
});

test('cancel close clears arm and stale state remains latched after reopen',async()=>{
  const {card}=setup(); let calls=0; card._hass.states.w={state:'idle',attributes:{can_cancel:true,operation_id:'old',session_id:'session'}}; card._hass.states.q={state:'pending',attributes:{minutes:2}}; card._hass.callService=async()=>calls++;
  card._updateFreshfeedStatus(); card._onCancelCountdown(); const dialog=card._dialog; dialog.el.remove=()=>{}; card._closeControls(); card._dialog=dialog; card._updateFreshfeedStatus(); card._onCancelCountdown(); assert.equal(calls,0); card._onCancelCountdown(); await new Promise(resolve=>setImmediate(resolve));
  card._closeControls(); card._dialog=dialog; card._updateFreshfeedStatus(); card._onCancelCountdown(); card._onCancelCountdown(); assert.equal(calls,1);
});

test('ambiguous cancel transport failure retains latch against stale pending',async()=>{
  const {card,cancelMessage}=setup(); let calls=0;
  card._hass.states.w={state:'idle',attributes:{can_cancel:true,session_id:'session'}}; card._hass.states.q={state:'pending',attributes:{minutes:1}};
  card._hass.callService=async()=>{calls++;throw Error('connection lost');}; card._updateFreshfeedStatus(); card._onCancelCountdown(); card._onCancelCountdown();
  await new Promise(resolve=>setImmediate(resolve)); assert.ok(card._cancelLatch); assert.match(cancelMessage.textContent,/uncertain/i);
  card._updateFreshfeedStatus(); card._onCancelCountdown(); card._onCancelCountdown(); assert.equal(calls,1);
});

test('recovery evidence must match accepted cancel recovery and session',async()=>{
  const {card,recovery}=setup(); const attrs={can_cancel:true,operation_id:'old',session_id:'session'};
  card._hass.states.w={state:'idle',attributes:attrs}; card._hass.states.q={state:'pending',attributes:{minutes:1}}; card._updateFreshfeedStatus(); card._onCancelCountdown(); card._onCancelCountdown(); await new Promise(resolve=>setImmediate(resolve));
  Object.assign(attrs,{operation_id:'new',operation:'cancel',recovery_phase:'awaiting_user_confirmation',recovery_can_start:true}); card._hass.states.w.state='uncertain'; card._updateFreshfeedStatus(); globalThis.confirm=()=>true;
  card._hass.callService=async()=>{throw Error('rejected');}; await recovery.querySelector('[data-recover]').click();
  attrs.recovery_phase='resolved'; card._hass.states.w.state='idle'; card._hass.states.q.state='idle'; card._updateFreshfeedStatus(); assert.ok(card._cancelLatch);
  attrs.recovery_phase='awaiting_user_confirmation'; card._hass.states.w.state='uncertain'; card._updateFreshfeedStatus(); card._hass.callService=async()=>{}; await recovery.querySelector('[data-recover]').click();
  attrs.recovery_phase='resolved'; card._hass.states.w.state='idle'; attrs.session_id='other'; card._updateFreshfeedStatus(); assert.ok(card._cancelLatch);
  attrs.session_id='session'; attrs.operation_id='unrelated'; card._updateFreshfeedStatus(); assert.ok(card._cancelLatch);
  attrs.operation_id=null; attrs.operation=null; card._updateFreshfeedStatus(); assert.equal(card._cancelLatch,null);
});

test('accepted recovery in a restarted session releases only after safe idle',async()=>{
  const {card,recovery}=setup();
  const attrs={can_cancel:true,operation_id:'old',session_id:'session'};
  card._hass.states.w={state:'idle',attributes:attrs}; card._hass.states.q={state:'pending',attributes:{minutes:1}};
  card._updateFreshfeedStatus(); card._onCancelCountdown(); card._onCancelCountdown(); await new Promise(resolve=>setImmediate(resolve));
  Object.assign(attrs,{operation_id:'new',session_id:'restarted',operation:'cancel',recovery_phase:'awaiting_user_confirmation',recovery_can_start:true}); card._hass.states.w.state='uncertain'; card._updateFreshfeedStatus();
  globalThis.confirm=()=>true; await recovery.querySelector('[data-recover]').click();
  Object.assign(attrs,{operation_id:null,operation:null,recovery_phase:'resolved'}); card._hass.states.w.state='idle'; card._hass.states.q.state='idle'; card._updateFreshfeedStatus();
  assert.equal(card._cancelLatch,null);
});

test('cancel latch is scoped to entry and retained when switching back',()=>{
  const {card,actions}=editable(); card._cancelLatch={entryId:'entry',operationId:'old',sessionId:'session'};
  card._updateFreshfeedStatus(); assert.equal(button(actions,'Save').disabled,true);
  card._config.freshfeed.entry_id='other'; card._updateFreshfeedStatus();
  assert.equal(button(actions,'Save').disabled,false); assert.equal(card._canFreshfeedAction('refilled'),true);
  card._config.freshfeed.entry_id='entry'; card._updateFreshfeedStatus(); assert.equal(button(actions,'Save').disabled,true);
});

test('uncertainty retains latch until explicit recovery and safe idle',async()=>{
  const {card,recovery,cancelMessage}=setup(); const attrs={can_cancel:true,operation_id:'old',session_id:'session'};
  card._hass.states.w={state:'idle',attributes:attrs}; card._hass.states.q={state:'pending',attributes:{minutes:1}}; card._updateFreshfeedStatus(); card._onCancelCountdown(); card._onCancelCountdown(); await new Promise(resolve=>setImmediate(resolve));
  Object.assign(attrs,{operation_id:'new',operation:'cancel',recovery_phase:'awaiting_user_confirmation',recovery_can_start:true}); card._hass.states.w.state='uncertain'; card._updateFreshfeedStatus(); assert.match(cancelMessage.textContent,/uncertain/i); assert.ok(card._cancelLatch);
  globalThis.confirm=()=>true; await recovery.querySelector('[data-recover]').click(); attrs.recovery_phase='resolved'; card._hass.states.w.state='idle'; card._updateFreshfeedStatus(); assert.ok(card._cancelLatch);
  attrs.operation_id=null; attrs.operation=null; card._hass.states.q.state='idle'; card._updateFreshfeedStatus(); assert.equal(card._cancelLatch,null);
});

test('reported countdown changes only with an HA report, not elapsed clock time',()=>{
  const {card,quickStatus}=setup();
  card._hass.states.q={state:'pending',attributes:{minutes:5}}; card._updateFreshfeedStatus();
  assert.match(quickStatus.textContent,/5 minutes/); const text=quickStatus.textContent;
  const now=Date.now; Date.now=()=>now()+86400000;
  try {
    card._updateFreshfeedStatus(); assert.equal(quickStatus.textContent,text);
    card._hass.states.q={state:'pending',attributes:{minutes:2}}; card._updateFreshfeedStatus();
    assert.match(quickStatus.textContent,/2 minutes/); assert.notEqual(quickStatus.textContent,text);
    card._hass.states.q={state:'pending',attributes:{minutes:0}}; card._updateFreshfeedStatus();
    const zero=quickStatus.textContent; assert.match(zero,/waiting for status/);
    card._updateFreshfeedStatus(); assert.equal(quickStatus.textContent,zero);
  } finally { Date.now=now; }
});

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

test('friendly history and localized quick and freshness times preserve provenance',()=>{
  const {card,history,quickTime,freshness}=setup();
  card._hass.language='en-US'; card._hass.states.q.last_updated='2026-01-01T00:00:00Z';
  card._hass.states.s.attributes.observed_at='2026-01-01T00:00:00Z';
  card._hass.states.h.attributes.events=[{at:'2026-01-01T00:00:00Z',kind:'dispensed',source_dp:145,report_value:3}];
  card._updateFreshfeedStatus();
  assert.match(history.children[1].textContent,/Meal dispensed \(observed\).*DP145.*report value 3/);
  assert.doesNotMatch(quickTime.textContent,/2026-01-01T/); assert.doesNotMatch(freshness.textContent,/2026-01-01T/);
});

function renderable(card){
  card._dialog=null;
  card._root=new Element(); card._root.classList={add(){},remove(){}};
  card._root.appendChild=function(node){ node.parentNode=this; this.children.push(node); return node; };
  Object.defineProperty(card._root,'innerHTML',{set(value){ for(const child of this.children) child.parentNode=null; this.children=[]; this._html=value; },get(){ return this._html||''; }});
  card.shadowRoot={activeElement:null}; card.attachShadow=()=>{};
  card._render=PetFeederCard.prototype._render;
}
const commandMessages=root=>root.children.filter(node=>node.attributes&&'data-command-message' in node.attributes);

test('rendered Feed and Defrost buttons follow backend gates when quick status is unknown',()=>{
  const {card}=setup(); renderable(card);
  card._config.actions=['feed','defrost'].map(operation=>({name:operation,icon:'mdi:food',data:{operation}}));
  for (const status of ['unknown','pending','feeding']) {
    for (const allowed of [true,false]) {
      card._hass.states.q={state:status,attributes:{}};
      card._hass.states.w.attributes.can_feed=allowed;
      card._hass.states.w.attributes.can_defrost=allowed;
      card._render();
      const buttons=[...card._root.innerHTML.matchAll(/<button class="round action[^>]+data-action="([01])"[^>]*>/g)].map(match=>match[0]);
      assert.equal(buttons.length,2);
      assert.equal(/ disabled/.test(buttons[0]),!allowed || status!=='unknown',`feed ${status} ${allowed}`);
      assert.equal(/ disabled/.test(buttons[1]),!allowed || status==='pending',`defrost ${status} ${allowed}`);
    }
  }
});

test('command rejection arriving while the controls dialog is open is shown in the dialog status region',async()=>{
  const ctx=setup(); const {card,section}=ctx; const dialog=card._dialog; renderable(card);
  const commandStatus=new Element('p'); const lookup=section.querySelector;
  section.querySelector=(s)=>s==='[data-command-status]'?commandStatus:lookup(s);
  card._config.actions=[{data:{operation:'feed'},confirm:false,icon:'mdi:food'}];
  let calls=0; let reject;
  card._hass.callService=()=>{calls++;return new Promise((_,rejectRequest)=>{reject=rejectRequest;});};
  card._render(); card._onAction(0); await new Promise(resolve=>setImmediate(resolve));
  card._dialog=dialog; card._updateFreshfeedStatus();
  assert.equal(commandStatus.textContent,'');
  reject(Error('private transport sentinel')); await new Promise(resolve=>setImmediate(resolve));
  assert.match(commandStatus.textContent,/request could not be confirmed/i);
  assert.doesNotMatch(commandStatus.textContent,/private transport sentinel/);
  assert.equal(calls,1);
  card._freshfeedCommandError=null; card._render();
  assert.equal(commandStatus.textContent,'');
  const source=readFileSync(new URL('../dist/pet-feeder-card.js', import.meta.url),'utf8');
  assert.match(source,/<p class="command-message" data-command-status role="status"><\/p>/);
});

test('command rejection appears in accessible status and clears when a new request starts',async()=>{
  const {card}=setup(); renderable(card);
  card._config.actions=[{data:{operation:'feed'},confirm:false,icon:'mdi:food'}];
  let calls=0;
  card._hass.callService=async()=>{calls++;throw Error('private transport sentinel');};
  card._render();
  assert.equal(commandMessages(card._root).length,0,'no empty status paragraph before an error');
  assert.doesNotMatch(card._root.innerHTML,/data-command-message/);
  card._onAction(0); await new Promise(resolve=>setImmediate(resolve));
  const [status]=commandMessages(card._root);
  assert.ok(status,'status element attached on error');
  assert.equal(status.attributes.role,'status');
  assert.equal(status.className,'command-message');
  assert.match(status.textContent,/request could not be confirmed/i);
  assert.doesNotMatch(status.textContent,/private transport sentinel/);
  assert.equal(calls,1);
  card._render();
  assert.equal(commandMessages(card._root)[0],status,'the same live region element is reused across renders');
  card._onAction(0);
  assert.equal(commandMessages(card._root).length,0);
  assert.equal(status.textContent,'');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls,2);
  assert.equal(commandMessages(card._root)[0],status);
});

test('command status text is set only after the live region is attached',async()=>{
  const {card}=setup(); renderable(card);
  card._config.actions=[{data:{operation:'feed'},confirm:false,icon:'mdi:food'}];
  card._hass.callService=async()=>{throw Error('x');};
  card._render(); card._onAction(0); await new Promise(resolve=>setImmediate(resolve));
  const [status]=commandMessages(card._root);
  let attachedAtWrite=null; let value=status.textContent;
  Object.defineProperty(status,'textContent',{set(v){ attachedAtWrite=this.parentNode===card._root; value=v; },get(){ return value; }});
  card._freshfeedCommandError=null; card._render(); card._freshfeedCommandError='Retry text'; card._render();
  assert.equal(attachedAtWrite,true);
  assert.equal(status.textContent,'Retry text');
});

test('Aqara cards never render the FreshFeed command status',()=>{
  const {card}=setup(); card._config=validateConfig({model:'aqara_c1',entities:{}}); renderable(card);
  card._freshfeedCommandError='Should not show';
  card._render();
  assert.equal(commandMessages(card._root).length,0);
  assert.doesNotMatch(card._root.innerHTML,/data-command-message/);
});

test('command status has explicit margin and error colour',()=>{
  const source=readFileSync(new URL('../dist/pet-feeder-card.js', import.meta.url),'utf8');
  const rule=source.match(/\n\.command-message \{([^}]*)\}/);
  assert.ok(rule,'.command-message rule exists');
  assert.match(rule[1],/margin:/); assert.match(rule[1],/color: var\(--error-color/);
});

test('card_preserves_unknown_cancel_latch_on_network_error',async()=>{
  const {card}=setup(); let calls=0;
  card._hass.states.w.attributes.can_cancel=true; card._hass.states.w.attributes.session_id='s'; card._hass.states.q.state='pending';
  card._hass.callService=async()=>{calls++;throw Error('network');};
  card._updateFreshfeedStatus(); card._onCancelCountdown(); card._onCancelCountdown(); await new Promise(resolve=>setImmediate(resolve));
  card._updateFreshfeedStatus(); card._onCancelCountdown(); card._onCancelCountdown(); assert.equal(calls,1); assert.ok(card._entryCancelLatch());
});

test('save rejection retains edits and displays an error',async()=>{
  const {card,editor,actions,message}=editable();
  const time=editor.children[0].children[1].children[0]; time.value='09:30'; await time.emit('input');
  card._hass.callService=async()=>{throw new Error('private');}; await button(actions,'Save').click();
  assert.match(message.textContent,/could not be confirmed.*Your edits have been retained/i); assert.doesNotMatch(message.textContent,/private/); assert.equal(time.value,'09:30');
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
  globalThis.confirm=()=>true; await recover.click(); assert.equal(calls,1); assert.match(message.textContent,/request could not be confirmed/i);
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

const LEAD_WARNING='A meal is due within 5 minutes. The feeder may already be preparing it; changes may not affect that meal. Saving is still allowed.';
test('lead-time warning is a separate polite live region in the dialog template',()=>{
  const source=readFileSync(new URL('../dist/pet-feeder-card.js', import.meta.url),'utf8');
  assert.match(source,/<p data-lead-time-warning role="status" aria-live="polite"><\/p>/);
});

test('test_warning_never_disables_save_or_changes_payload',async()=>{
  const {card,actions,leadWarning,message}=editable(); const calls=[]; card._hass.callService=async(...args)=>calls.push(args);
  card._now=()=>new Date('2026-11-18T06:57:00Z'); card._updateFreshfeedStatus();
  assert.equal(leadWarning.textContent,LEAD_WARNING); assert.equal(message.textContent,'');
  assert.equal(button(actions,'Save').disabled,false);
  await button(actions,'Save').click();
  assert.deepEqual(calls,[['petsafe_freshfeed','save_schedule',{entry_id:'entry',base_revision:'rev',entries:[{weekmask:127,hour:7,minute:0,enabled:true,audible:false}]}]]);
  assert.equal(button(actions,'Save').disabled,false); assert.equal(leadWarning.textContent,LEAD_WARNING);
  for (const [apply,undo] of [
    [()=>{card._hass.states.s.attributes.revision='other';},()=>{card._hass.states.s.attributes.revision='rev';}],
    [()=>{card._hass.states.w.attributes.storage_fault=true;},()=>{delete card._hass.states.w.attributes.storage_fault;}],
    [()=>{card._hass.states.w.state='pending';},()=>{card._hass.states.w.state='idle';}],
  ]) {
    apply(); card._updateFreshfeedStatus();
    assert.equal(button(actions,'Save').disabled,true); assert.equal(leadWarning.textContent,LEAD_WARNING);
    await button(actions,'Save').click(); assert.equal(calls.length,1);
    undo(); card._updateFreshfeedStatus(); assert.equal(button(actions,'Save').disabled,false);
  }
});

test('test_deleted_current_near_meal_still_warns',async()=>{
  const {card,editor,actions,leadWarning}=editable(); card._now=()=>new Date('2026-11-18T06:58:00Z'); card._updateFreshfeedStatus();
  assert.equal(leadWarning.textContent,LEAD_WARNING);
  await button(editor.children[0],'Delete').click();
  assert.equal(card._dialog.freshfeed.draft.entries.length,0);
  assert.equal(leadWarning.textContent,LEAD_WARNING); assert.equal(button(actions,'Save').disabled,false);
});

test('draft-only near meal warns and timing loss is advisory only',async()=>{
  const {card,editor,actions,leadWarning}=editable(); card._now=()=>new Date('2026-11-18T08:57:00Z'); card._updateFreshfeedStatus();
  assert.equal(leadWarning.textContent,'');
  const time=editor.children[0].children[1].children[0]; time.value='09:00'; await time.emit('input');
  assert.equal(leadWarning.textContent,LEAD_WARNING);
  card._hass.config.time_zone=undefined; card._updateFreshfeedStatus();
  assert.equal(leadWarning.textContent,'Meal timing is unavailable. The feeder may already be preparing a meal; saving is still allowed.');
  assert.equal(button(actions,'Save').disabled,false);
});

test('test_tick_updates_warning_without_rebuilding_input',()=>{
  const {card,editor,leadWarning}=editable(); let now=new Date('2026-11-18T06:50:00Z'); card._now=()=>now;
  card.attachShadow=()=>{}; delete card._render; card._updateFreshfeedStatus();
  const draft=card._dialog.freshfeed.draft; const field=editor.children[0]; const input=field.children[1].children[0];
  assert.equal(leadWarning.textContent,'');
  now=new Date('2026-11-18T06:56:00Z'); card._render();
  assert.equal(leadWarning.textContent,LEAD_WARNING);
  assert.strictEqual(editor.children[0],field); assert.strictEqual(field.children[1].children[0],input); assert.strictEqual(card._dialog.freshfeed.draft,draft);
  now=new Date('2026-11-18T07:01:00Z'); card._render();
  assert.equal(leadWarning.textContent,''); assert.strictEqual(editor.children[0],field);
});

// Layout and focus behaviour are proven in a real browser by
// test/freshfeed-reparent-focus.test.mjs and harness/check-freshfeed-accessibility.mjs;
// these checks pin the markup those depend on.
test('dialog_has_label_modal_and_initial_focus: template is modal and labelled by its visible title',()=>{
  const source=readFileSync(new URL('../dist/pet-feeder-card.js', import.meta.url),'utf8');
  assert.match(source,/<div class="panel" role="dialog" aria-modal="true" aria-labelledby="\$\{titleId\}" tabindex="-1">/);
  assert.match(source,/<span class="panel-title" id="\$\{titleId\}">/);
  assert.doesNotMatch(source,/role="dialog" aria-label=/);
});

test('meal fieldsets, day toggles and delete carry the responsive layout hooks',()=>{
  const {editor}=editable();
  const field=editor.children[0];
  assert.equal(field.className,'meal');
  const days=field.children.filter(node=>node.attributes['aria-pressed']!==undefined);
  assert.equal(days.length,7); assert.ok(days.every(node=>node.className==='day'));
  assert.equal(button(field,'Delete').className,'meal-delete');
  // Existing child order (legend, time label, days, flags, delete) is unchanged.
  assert.equal(field.children[1].children[0].type,'time'); assert.equal(field.children[9].children[0].type,'checkbox');
});

test('closing without a browser DOM is idempotent and never throws',()=>{
  const {card}=setup(); const dialog=card._dialog; dialog.el.remove=()=>{};
  card._closeControls(); card._closeControls({restoreFocus:false}); card._closeControls();
  assert.equal(card._dialog,null); assert.equal(card._activeDialog,null);
});
