import test from 'node:test';
import assert from 'node:assert/strict';
import { PetFeederCard, validateConfig } from '../card/pet-feeder-card.js';
import { freshfeedView } from '../card/freshfeed-model.js';

const config = () => ({model:'freshfeed',entities:{},freshfeed:{entry_id:'entry',schedule_entity:'s',write_status_entity:'w',quick_feed_entity:'q',history_entity:'h'},actions:['feed','defrost','refilled'].map(operation=>({name:operation,action:'petsafe_freshfeed.command',data:{operation},confirm:true}))});
function setup() {
  const card=new PetFeederCard(); card._config=validateConfig(config()); card._render=()=>{};
  const calls=[];
  card._hass={states:{w:{state:'idle',attributes:{can_feed:true,can_defrost:true,can_refilled:true}},q:{state:'idle',attributes:{}}},callService:async(...args)=>calls.push(args)};
  return {card,calls};
}

test('every parity command requires two taps, exact routing and latches rapid third tap',async()=>{
  for (const [i,operation] of ['feed','defrost','refilled'].entries()) {
    const {card,calls}=setup(); let resolve;
    card._hass.callService=(...args)=>{calls.push(args);return new Promise(r=>{resolve=r;});};
    card._onAction(i); assert.equal(calls.length,0);
    card._onAction(i); card._onAction(i); await Promise.resolve();
    assert.deepEqual(calls,[['petsafe_freshfeed','command',{entry_id:'entry',operation,confirmed:true}]]);
    resolve(); await Promise.resolve(); await Promise.resolve(); card._disarm(false);
  }
});

test('common server gates and missing source fail closed for all commands',()=>{
  for(const state of ['pending','uncertain','blocked','unavailable','unknown']) {
    const {card}=setup(); card._hass.states.w.state=state;
    for(const operation of ['feed','defrost','refilled']) assert.equal(card._canFreshfeedAction(operation),false,state);
  }
  for(const fault of ['storage_fault','integrity_fault']) {
    const {card}=setup(); card._hass.states.w.attributes[fault]=true;
    for(const operation of ['feed','defrost','refilled']) assert.equal(card._canFreshfeedAction(operation),false);
  }
  const {card}=setup(); delete card._hass.states.w;
  assert.equal(card._canFreshfeedAction('feed'),false);
});

test('feed and defrost obey live quick status and server exhausted/active restrictions',()=>{
  for(const state of ['pending','feeding','unknown','unavailable','unexpected']) {
    const {card}=setup(); card._hass.states.q.state=state;
    assert.equal(card._canFreshfeedAction('feed'),false,state);
  }
  const {card}=setup(); card._hass.states.q.state='pending'; assert.equal(card._canFreshfeedAction('defrost'),false);
  card._hass.states.q.state='idle'; card._hass.states.w.attributes.can_feed=false;
  card._hass.states.w.attributes.can_defrost=false;
  assert.equal(card._canFreshfeedAction('feed'),false,'exhausted counter server flag');
  assert.equal(card._canFreshfeedAction('defrost'),false,'active defrost server flag');
  assert.equal(freshfeedView(card._config,card._hass).quickFeed.minutes,null);
});

test('parity rejects raw bypasses, cancel/now and placeholder while legacy and raw stay isolated',()=>{
  for(const action of ['button.press','text.set_value']) assert.throws(()=>validateConfig({...config(),actions:[{action,target:{entity_id:'button.raw'}}]}));
  for(const operation of ['cancel','now']) assert.throws(()=>validateConfig({...config(),actions:[{action:'petsafe_freshfeed.command',data:{operation}}]}));
  assert.throws(()=>validateConfig({...config(),controls:['text.raw']}));
  const c=config(); c.freshfeed.entry_id='REPLACE_WITH_INTEGRATION_ENTRY_ID'; assert.throws(()=>validateConfig(c),/bind/);
  assert.doesNotThrow(()=>validateConfig({model:'aqara_c1',entities:{},actions:[{action:'button.press',target:{entity_id:'button.raw'}}]}));
  const {card,calls}=setup(); card._config.mode='raw'; card._onAction(0); card._onAction(0); assert.equal(calls.length,0);
});
