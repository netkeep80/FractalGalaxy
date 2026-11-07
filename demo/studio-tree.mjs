import {
  octreeKey,octreeTreeRows,expandedForOctreeSelection,
  e0SplitTreeRows,fractalRingTreeRows,MAX_STUDIO_TREE_DEPTH
} from './studio-hierarchy.mjs';
import {formatPath} from './studio-picking.mjs';

// A single accessible tree controller for separate, non-interchangeable hierarchies.
const MODES=['octree','split','physical','source'];
export function createStudioHierarchyUI({
  mount,translate,getLocale,getSelectedPath,getSelectedOwner,
  getSplitModel,getWorldStore,core,onSelectOctree,onSelectSplit
}) {
  const expanded={
    octree:new Set(),
    split:new Set(['split:root','split:right']),
    physical:new Set(),
    source:new Set()
  };
  let mode='octree',lastSelection=null,lastLocale=null,dirty=true;
  let lastRows=[],selectedRingId=null;
  const heading=document.createElement('h4');
  heading.className='studio-tree-title';
  const tabs=document.createElement('div');
  tabs.className='studio-tree-tabs';
  tabs.setAttribute('role','tablist');
  const panel=document.createElement('div');
  panel.className='studio-tree-panel';
  panel.id='studioHierarchyTree';
  panel.setAttribute('role','tree');
  panel.tabIndex=-1;
  const message=document.createElement('p');
  message.className='studio-tree-note';
  const details=document.createElement('div');
  details.className='studio-tree-details';
  details.id='studioRingDetails';
  mount.append(heading,tabs,panel,message,details);

  function rows(){
    if(mode==='octree')return octreeTreeRows({expanded:expanded.octree,selected:getSelectedPath(),
      maxDepth:MAX_STUDIO_TREE_DEPTH});
    if(mode==='split')return e0SplitTreeRows(getSplitModel(),{expanded:expanded.split})
      .map(row=>({...row,selected:row.owner===getSelectedOwner()}));
    const relation=mode==='source'?'source':'physical';
    return fractalRingTreeRows(getWorldStore(),{relation,expanded:expanded[mode],core})
      .map(row=>({...row,selected:row.ringId===selectedRingId}));
  }
  function detailText(){
    if(!selectedRingId || !getWorldStore().records[selectedRingId] || (mode!=='physical' && mode!=='source'))return '';
    const record=getWorldStore().records[selectedRingId];
    return [record.id,translate('studio.tree.state')+': '+translate('studio.tree.'+core.ringRecordState(getWorldStore(),record.id)),
      translate('studio.tree.sourcePath')+': '+record.source.rootId+formatPath(record.source.address),
      record.source.algorithmId+'@'+record.source.algorithmVersion].join(' · ');
  }
  function render(focusKey=null){
    const selectedPath=getSelectedPath(), selectedSignature=formatPath(selectedPath);
    const locale=getLocale();
    if(lastSelection!==selectedSignature){
      expanded.octree=expandedForOctreeSelection(expanded.octree,selectedPath);
      lastSelection=selectedSignature;
      dirty=true;
    }
    if(lastLocale!==locale){lastLocale=locale;dirty=true;}
    if(!dirty)return;
    dirty=false;
    heading.textContent=translate('studio.tree.title');
    tabs.replaceChildren();
    for(const name of MODES){
      const button=document.createElement('button');
      button.type='button';
      button.id='studioHierarchyTab_'+name;
      button.dataset.treeMode=name;
      button.setAttribute('role','tab');
      button.setAttribute('aria-selected',String(mode===name));
      button.setAttribute('aria-controls',panel.id);
      button.textContent=translate('studio.tree.'+name);
      tabs.append(button);
    }
    panel.setAttribute('aria-label',translate('studio.tree.'+mode));
    lastRows=rows();
    const fragment=document.createDocumentFragment();
    for(const row of lastRows){
      const line=document.createElement('div');
      line.className='studio-tree-row';
      line.setAttribute('role','none');
      line.style.paddingInlineStart=(row.depth*14)+'px';
      const toggle=document.createElement('button');
      toggle.type='button';
      toggle.className='studio-tree-toggle';
      toggle.dataset.treeToggle=row.key;
      toggle.disabled=!row.hasChildren;
      toggle.setAttribute('aria-label',translate('studio.tree.'+(row.expanded?'collapse':'expand')));
      toggle.textContent=row.hasChildren?(row.expanded?'▾':'▸'):'·';
      const node=document.createElement('button');
      node.type='button';
      node.className='studio-tree-node';
      node.setAttribute('role','treeitem');
      node.dataset.treeKey=row.key;
      node.dataset.treeKind=row.kind;
      node.setAttribute('aria-level',String(row.depth+1));
      node.setAttribute('aria-selected',String(Boolean(row.selected)));
      if(row.hasChildren)node.setAttribute('aria-expanded',String(row.expanded));
      node.tabIndex=lastRows.findIndex(item=>item.selected)===-1
        ? (lastRows[0]===row?0:-1) : (row.selected?0:-1);
      const label=document.createElement('span');
      label.className='studio-tree-label';
      label.textContent=row.label;
      node.append(label);
      if(row.kind==='octree'){
        const suffix=document.createElement('small');
        suffix.textContent='L'+row.depth+' · '+formatPath(row.path);
        node.append(suffix);
      }else if(row.kind==='source'){
        const virtual=document.createElement('small');
        virtual.textContent=translate('studio.tree.virtual')+' · '+formatPath(row.path);
        node.append(virtual);
      }else if(row.kind==='ring'){
        const status=document.createElement('small');
        status.textContent=translate('studio.tree.'+row.status);
        node.append(status);
      }else if(row.kind==='split-stage'){
        const caption=document.createElement('small');
        caption.textContent=translate('studio.tree.splitStage');
        node.append(caption);
      }
      line.append(toggle,node);
      fragment.append(line);
    }
    panel.replaceChildren(fragment);
    message.textContent=lastRows.length===0
      ? translate('studio.tree.empty')
      : translate('studio.tree.note.'+mode);
    details.textContent=detailText();
    if(focusKey){
      const target=[...panel.querySelectorAll('[data-tree-key]')].find(el=>el.dataset.treeKey===focusKey);
      target?.focus();
    }
  }
  function toggle(key,focus=false){
    const current=lastRows.find(row=>row.key===key);
    if(!current?.hasChildren)return;
    if(expanded[mode].has(key))expanded[mode].delete(key);
    else expanded[mode].add(key);
    dirty=true;
    render(focus?key:null);
  }
  function activate(key){
    const row=lastRows.find(row=>row.key===key);
    if(!row)return;
    if(row.kind==='octree')onSelectOctree(row.path);
    else if(row.kind==='split-leaf')onSelectSplit(row.owner);
    else if(row.kind==='ring'){selectedRingId=row.ringId;dirty=true;}
    else if(row.hasChildren)toggle(key);
    dirty=true;
    render(key);
  }
  tabs.addEventListener('click',event=>{
    const button=event.target.closest('button[data-tree-mode]');
    if(!button)return;
    mode=button.dataset.treeMode;
    dirty=true;
    render();
  });
  panel.addEventListener('click',event=>{
    const toggleButton=event.target.closest('button[data-tree-toggle]');
    if(toggleButton){toggle(toggleButton.dataset.treeToggle,true);return;}
    const node=event.target.closest('button[data-tree-key]');
    if(node)activate(node.dataset.treeKey);
  });
  panel.addEventListener('keydown',event=>{
    const target=event.target.closest('button[data-tree-key]');
    if(!target)return;
    const key=target.dataset.treeKey;
    const index=lastRows.findIndex(row=>row.key===key);
    const row=lastRows[index];
    if(!row)return;
    const focus=(next)=>{
      if(!next)return;
      const node=[...panel.querySelectorAll('[data-tree-key]')].find(el=>el.dataset.treeKey===next.key);
      node?.focus();
    };
    if(event.key==='ArrowDown'){event.preventDefault();focus(lastRows[Math.min(index+1,lastRows.length-1)]);}
    else if(event.key==='ArrowUp'){event.preventDefault();focus(lastRows[Math.max(0,index-1)]);}
    else if(event.key==='Home'){event.preventDefault();focus(lastRows[0]);}
    else if(event.key==='End'){event.preventDefault();focus(lastRows[lastRows.length-1]);}
    else if(event.key==='ArrowRight'&&row.hasChildren&&!row.expanded){event.preventDefault();toggle(key,true);}
    else if(event.key==='ArrowLeft'){
      event.preventDefault();
      if(row.hasChildren&&row.expanded)toggle(key,true);
      else {
        for(let i=index-1;i>=0;i--)if(lastRows[i].depth===row.depth-1){focus(lastRows[i]);break;}
      }
    }else if(event.key==='Enter'||event.key===' '){event.preventDefault();activate(key);}
  });
  return {
    sync(){render();},
    open(modeName){if(!MODES.includes(modeName))throw new RangeError('unknown hierarchy mode');mode=modeName;dirty=true;render();},
    refresh(){dirty=true;render();},
    mode(){return mode;}
  };
}
