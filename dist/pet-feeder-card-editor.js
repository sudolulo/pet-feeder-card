import { bindDiscoveredFeeder, discoverFreshfeedBindings, freshfeedDevices, patchEditorConfig } from './freshfeed-editor-model.js?v=0.4.2';
const JSON_FIELDS = ['chip','footer','entities','raw_entities','freshfeed','actions','controls'];
const SEMANTIC = ['entry_id','schedule_entity','write_status_entity','quick_feed_entity','history_entity'];
const Base = globalThis.HTMLElement ?? class {};
export class PetFeederCardEditor extends Base {
  constructor() {
    super(); this.attachShadow({mode:'open'}); this._generation=0; this._config={model:'freshfeed'}; this._draft=structuredClone(this._config);
  }
  setConfig(config) {
    // Home Assistant echoes each emitted config back; an unchanged config keeps the DOM, focus and drafts.
    if (this.shadowRoot.childElementCount && JSON.stringify(config)===JSON.stringify(this._config)) return;
    this._pending={}; this._config=structuredClone(config); this._draft=structuredClone(config); this._render();
  }
  set hass(hass) {
    // Home Assistant replaces hass on every state change; reload registries only for a new connection.
    const key=hass?.connection ?? hass;
    this._hass=hass;
    if (key === this._registryKey) return;
    this._registryKey=key; this._loadRegistry(hass);
  }
  connectedCallback() { if (this._hass && this._registryKey===undefined) this.hass=this._hass; }
  async _loadRegistry(hass) {
    const generation=++this._generation;
    this._loading=true;
    this._registry=null;
    try {
      const [devices,entities,configEntries]=await Promise.all(['config/device_registry/list','config/entity_registry/list','config_entries/get'].map(type=>hass.callWS({type})));
      if (generation!==this._generation) return;
      if (![devices,entities,configEntries].every(Array.isArray)) throw Error();
      this._registry={devices,entities,configEntries}; this._registryError='';
    } catch {
      if (generation!==this._generation) return;
      this._registryError='Registry unavailable. Use manual entry and entity fields below.';
    }
    this._loading=false;
    this._renderRegistry();
  }
  disconnectedCallback() { ++this._generation; if (this._loading) { this._loading=false; this._registryKey=undefined; } }
  // Update only registry-derived nodes so focus and uncommitted input elsewhere survive.
  _renderRegistry() {
    const picker=this.shadowRoot.querySelector('[data-device]');
    if (!picker) return this._render();
    const selected=picker.value;
    picker.replaceChildren(new Option('Select a feeder (optional)',''));
    for(const device of freshfeedDevices(this._registry || {})) picker.add(new Option(device.name_by_user || device.name || 'FreshFeed',device.id));
    if ([...picker.options].some(o=>o.value===selected)) picker.value=selected;
    this._message(this._registryError || '');
  }
  _message(text) { const node=this.shadowRoot.querySelector('[role="status"]'); if(node) node.textContent=text; }
  _apply(patch) {
    try {
      this._emit(patchEditorConfig(this._config,patch));
    } catch { this._message('Configuration is incomplete or incompatible. Check the manual fields; no invalid configuration has been emitted.'); }
  }
  _emit(next) {
    this._config=structuredClone(next); this._draft=structuredClone(next);
    this._pending={};
    const active=this.shadowRoot.activeElement;
    const selector=active?.dataset.field !== undefined ? `[data-field="${active.dataset.field}"]` : active?.dataset.semantic !== undefined ? `[data-semantic="${active.dataset.semantic}"]` : active?.hasAttribute('data-device') ? '[data-device]' : null;
    this.dispatchEvent(new CustomEvent('config-changed',{detail:{config:structuredClone(next)},bubbles:true,composed:true}));
    this._render();
    if (selector) this.shadowRoot.querySelector(selector)?.focus();
    this._message(this._registryError || '');
  }
  _render() {
    const root=this.shadowRoot; root.replaceChildren();
    const style=document.createElement('style'); style.textContent=':host{display:block}label{display:grid;gap:4px;margin:12px 0}input,select,textarea{box-sizing:border-box;width:100%;font:inherit;padding:8px}textarea{min-height:70px}p{overflow-wrap:anywhere}'; root.append(style);
    const note=document.createElement('p'); note.textContent='Changing model or mode resets incompatible entity, tray and action fields. Changing feeder clears controls and actions; add them explicitly. Raw mode requires at least one raw entity. Advanced lists and mappings use JSON. Manual configuration remains available.'; root.append(note);
    const status=document.createElement('p'); status.setAttribute('role','status'); status.textContent=this._registryError || ''; root.append(status);
    const field=(label,element)=>{const wrapper=document.createElement('label'); wrapper.append(document.createTextNode(label),element); root.append(wrapper); return element;};
    const picker=field('FreshFeed device',document.createElement('select')); picker.dataset.device='';
    picker.add(new Option('Select a feeder (optional)',''));
    for(const device of freshfeedDevices(this._registry || {})) picker.add(new Option(device.name_by_user || device.name || 'FreshFeed',device.id));
    picker.addEventListener('change',()=>{
      if(!picker.value) return;
      const result=discoverFreshfeedBindings(this._registry || {},picker.value);
      if(result.error) {this._message(result.error);return;}
      // Discovery is synchronous over one registry snapshot, so a later selection
      // cannot be overwritten by an earlier asynchronous entity lookup.
      try {
        this._emit(bindDiscoveredFeeder(this._config,result.config));
      } catch { this._message('Configuration is incomplete or incompatible. Check the manual fields; no invalid configuration has been emitted.'); }
    });
    for(const key of ['name','model','mode','color','meal_slots',...JSON_FIELDS]) {
      const choices={model:['freshfeed','aqara_c1'],mode:['standard','raw'],color:['black','white']}[key];
      const element=document.createElement(choices?'select':JSON_FIELDS.includes(key)?'textarea':'input');
      element.dataset.field=key;
      if(choices) for(const value of choices) element.add(new Option(value,value));
      const value=this._draft[key];
      element.value=JSON_FIELDS.includes(key)?(value===undefined?'':JSON.stringify(value,null,2)):(value ?? (key==='mode'?'standard':key==='color'?(this._draft.model==='aqara_c1'?'white':'black'):''));
      field(key.replaceAll('_',' '),element);
      element.addEventListener('change',()=>{
        try {
          let value=element.value;
          if(JSON_FIELDS.includes(key)) value=value.trim()?JSON.parse(value):undefined;
          if(key==='meal_slots') value=value.trim()?Number(value):undefined;
          if(key==='name' && !value.trim()) value=undefined;
          this._draft[key]=value;
          // Only edited fields are patches: preserve untouched advanced config.
          this._pending={...(this._pending || {}),[key]:value};
          this._apply(this._pending);
          if(this._config[key]===value || JSON.stringify(this._config[key])===JSON.stringify(value)) this._pending={};
        } catch {this._message('Enter valid JSON. No configuration change has been emitted.');}
      });
    }
    for(const key of SEMANTIC) {
      const input=field(`Manual FreshFeed ${key.replaceAll('_',' ')}`,document.createElement('input'));
      input.value=this._draft.freshfeed?.[key] || ''; input.dataset.semantic=key;
      input.addEventListener('change',()=>{
        const previous=this._draft.freshfeed?.entry_id;
        if (key==='entry_id' && previous && input.value!==previous) {
          // A new entry invalidates every route of the previous feeder: clear them visibly
          // and emit nothing until all four routes for the new entry are entered.
          this._draft.freshfeed={entry_id:input.value};
          delete this._draft.entities;
          for (const other of root.querySelectorAll('[data-semantic]')) if (other!==input) other.value='';
          const entities=root.querySelector('[data-field="entities"]'); if (entities) entities.value='';
          const {entities:_dropped,...rest}=this._pending || {};
          this._pending=rest;
        } else {
          this._draft.freshfeed={...(this._draft.freshfeed || {}),[key]:input.value};
        }
        this._pending={...(this._pending || {}),freshfeed:this._draft.freshfeed};
        this._apply(this._pending);
      });
    }
  }
}
if(globalThis.customElements && !customElements.get('pet-feeder-card-editor')) customElements.define('pet-feeder-card-editor',PetFeederCardEditor);
