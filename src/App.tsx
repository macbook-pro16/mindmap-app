import { useState, useCallback, useRef, useEffect } from 'react';
import type { KeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import * as Y from 'yjs';
import { supabase } from './supabaseClient';
import type { RealtimeChannel } from '@supabase/supabase-js';

// --------------------- 型定義 ---------------------
interface MindNode {
  id: string;
  text: string;
  children: MindNode[];
  x: number;
  y: number;
  independent?: boolean;
  bgColor?: string;
  textColor?: string;
}

interface FlatNode {
  id: string;
  x: number;
  y: number;
  parentId?: string;
  parentX?: number;
  parentY?: number;
  independent?: boolean;
  bgColor?: string;
  textColor?: string;
}

interface MapRecord {
  id: number;
  title: string;
  data: MindNode;
  room_id: string;
  created_at: string;
}

interface AwarenessState {
  email: string;
  color: string;
  selectedNodeId: string | null;
  editingNodeId: string | null;
}

interface ContextMenuInfo {
  visible: boolean;
  x: number;
  y: number;
  type: 'node' | 'canvas' | 'edge' | 'colorPalette' | 'image';
  nodeId?: string;
  edgeId?: string;
  imageId?: string;
  canvasX?: number;
  canvasY?: number;
}

type ConnectionPoint = 'top' | 'right' | 'bottom' | 'left';
type EdgeStyle = 'bezier' | 'step' | 'straight';

interface EdgeData {
  id: string;
  sourceNodeId: string;
  sourcePoint: ConnectionPoint;
  targetNodeId: string;
  targetPoint: ConnectionPoint;
  arrow: 'none' | 'start' | 'end' | 'both';
}

interface ImageData {
  id: string;
  storagePath: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

const COLOR_PALETTE = [
  { bg: '#f0f9ff', text: '#0369a1', label: '青' },
  { bg: '#f0fdf4', text: '#166534', label: '緑' },
  { bg: '#fff7ed', text: '#c2410c', label: 'オレンジ' },
  { bg: '#fdf2f8', text: '#9d174d', label: 'ピンク' },
  { bg: '#f5f3ff', text: '#5b21b6', label: '紫' },
  { bg: '#fefce8', text: '#854d0e', label: '黄' },
  { bg: '#f1f5f9', text: '#334155', label: 'グレー' },
  { bg: '#fef2f2', text: '#991b1b', label: '赤' },
];

const NODE_WIDTH = 160;
const NODE_HEIGHT = 50;

// --------------------- 幾何学・座標・描画ユーティリティ ---------------------
const getConnectionPoint = (x: number, y: number, point: ConnectionPoint): { x: number; y: number } => {
  switch (point) {
    case 'top':    return { x, y: y - NODE_HEIGHT / 2 };
    case 'right':  return { x: x + NODE_WIDTH / 2, y };
    case 'bottom': return { x, y: y + NODE_HEIGHT / 2 };
    case 'left':   return { x: x - NODE_WIDTH / 2, y };
  }
};

const findClosestConnectionPoint = (nodeX: number, nodeY: number, targetX: number, targetY: number): ConnectionPoint => {
  const points: ConnectionPoint[] = ['top', 'right', 'bottom', 'left'];
  let closest: ConnectionPoint = 'top';
  let minDist = Infinity;
  for (const p of points) {
    const pt = getConnectionPoint(nodeX, nodeY, p);
    const dist = Math.hypot(pt.x - targetX, pt.y - targetY);
    if (dist < minDist) { minDist = dist; closest = p; }
  }
  return closest;
};

// ★ 修正：ベジェ曲線の「集約的配置（フォーク化）」
const getBezierPath = (p1: { x: number; y: number }, p2: { x: number; y: number }, p1Dir: ConnectionPoint, p2Dir: ConnectionPoint): string => {
  const offset1 = 50;
  const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const offset2 = Math.min(80, Math.max(30, dist * 0.4));

  const getCP = (pt: { x: number; y: number }, dir: ConnectionPoint, offset: number) => {
    switch (dir) {
      case 'top': return { x: pt.x, y: pt.y - offset };
      case 'bottom': return { x: pt.x, y: pt.y + offset };
      case 'left': return { x: pt.x - offset, y: pt.y };
      case 'right': return { x: pt.x + offset, y: pt.y };
    }
  };
  const cp1 = getCP(p1, p1Dir, offset1);
  const cp2 = getCP(p2, p2Dir, offset2);
  return `M ${p1.x} ${p1.y} C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${p2.x} ${p2.y}`;
};

// ★ 直角の折れ線（ステップパス）
const getStepPath = (p1: { x: number; y: number }, p2: { x: number; y: number }, p1Dir: ConnectionPoint): string => {
  if (p1Dir === 'right' || p1Dir === 'left') {
    const midX = (p1.x + p2.x) / 2;
    return `M ${p1.x} ${p1.y} L ${midX} ${p1.y} L ${midX} ${p2.y} L ${p2.x} ${p2.y}`;
  } else {
    const midY = (p1.y + p2.y) / 2;
    return `M ${p1.x} ${p1.y} L ${p1.x} ${midY} L ${p2.x} ${midY} L ${p2.x} ${p2.y}`;
  }
};

// ★ 直線
const getStraightPath = (p1: { x: number; y: number }, p2: { x: number; y: number }): string => {
  return `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`;
};

// ★ スタイルごとのパス分岐
const getEdgePath = (p1: { x: number; y: number }, p2: { x: number; y: number }, p1Dir: ConnectionPoint, p2Dir: ConnectionPoint, style: EdgeStyle): string => {
  switch (style) {
    case 'straight': return getStraightPath(p1, p2);
    case 'step': return getStepPath(p1, p2, p1Dir);
    case 'bezier':
    default: return getBezierPath(p1, p2, p1Dir, p2Dir);
  }
};

const getUnoccupiedPosition = (startX: number, startY: number, yNodes: Y.Map<any>): { x: number; y: number } => {
  let x = startX;
  let y = startY;
  let isOccupied = true;
  while (isOccupied) {
    let collision = false;
    yNodes.forEach((node: any) => {
      if (Math.abs(node.x - x) < 15 && Math.abs(node.y - y) < 15) {
        collision = true;
      }
    });
    isOccupied = collision;
    if (isOccupied) {
      y += NODE_HEIGHT + 20;
    }
  }
  return { x, y };
};

const flattenTree = (node: MindNode, parentId?: string, parentX?: number, parentY?: number): FlatNode[] => {
  const current: FlatNode = {
    id: node.id, x: node.x, y: node.y,
    parentId, parentX, parentY,
    independent: node.independent,
    bgColor: node.bgColor,
    textColor: node.textColor,
  };
  const children = node.children.flatMap(c => flattenTree(c, node.id, node.x, node.y));
  return [current, ...children];
};

const getAllNodes = (root: MindNode): MindNode[] => {
  const result: MindNode[] = [root];
  root.children.forEach(c => result.push(...getAllNodes(c)));
  return result;
};

// --------------------- アイコン ---------------------
const UndoIcon = () => ( <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a5 5 0 015 5v2M3 10l4-4M3 10l4 4" /></svg> );
const RedoIcon = () => ( <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 10H11a5 5 0 00-5 5v2m15-7l-4-4m4 4l-4 4" /></svg> );
const PlusIcon = () => ( <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg> );
const SaveIcon = () => ( <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v11a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-4 0V4m0 3h4m-4 0H8" /></svg> );
const FolderIcon = () => ( <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" /></svg> );
const LinkIcon = () => ( <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 010 5.656l-2.828 2.828a4 4 0 01-5.656-5.656l2.828-2.828m6.364-6.364a4 4 0 010 5.656l-2.828 2.828a4 4 0 01-5.656-5.656l2.828-2.828" /></svg> );
const HomeIcon = () => ( <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg> );
const AlignVIcon = () => ( <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><line x1="12" y1="3" x2="12" y2="21" strokeWidth={2} /><path strokeWidth={2} d="M5 7l7-4 7 4M5 17l7 4 7-4" /></svg> );
const AlignHIcon = () => ( <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><line x1="3" y1="12" x2="21" y2="12" strokeWidth={2} /><path strokeWidth={2} d="M7 5l-4 7 4 7M17 5l4 7-4 7" /></svg> );
const PaletteIcon = () => ( <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" /></svg> );
const TrashIcon = () => ( <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg> );
const SubNodeIcon = () => ( <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg> );
const SiblingNodeIcon = () => ( <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" /></svg> );

// --------------------- データ変換ユーティリティ ---------------------
const yMapToTree = (nodes: Y.Map<any>, rootId: string): MindNode | null => {
  const convert = (id: string): MindNode | null => {
    const data = nodes.get(id);
    if (!data) return null;
    const children = (data.children || []).map((childId: string) => convert(childId)).filter(Boolean) as MindNode[];
    return {
      id, text: data.text, x: data.x, y: data.y,
      independent: data.independent ?? false,
      bgColor: data.bgColor ?? '#f0f9ff',
      textColor: data.textColor ?? '#0369a1',
      children,
    };
  };
  return convert(rootId);
};

const treeToYMap = (root: MindNode, nodes: Y.Map<any>) => {
  nodes.set(root.id, {
    text: root.text, x: root.x, y: root.y,
    independent: root.independent ?? false,
    bgColor: root.bgColor ?? '#f0f9ff',
    textColor: root.textColor ?? '#0369a1',
    children: root.children.map(c => c.id),
  });
  root.children.forEach(c => treeToYMap(c, nodes));
};

const uint8ArrayToBase64 = (u8: Uint8Array): string => { let binary = ''; for (let i = 0; i < u8.byteLength; i++) binary += String.fromCharCode(u8[i]); return btoa(binary); };
const base64ToUint8Array = (b64: string): Uint8Array => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
const stringToColor = (str: string): string => { let hash = 0; for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash); return `hsl(${Math.abs(hash) % 360}, 70%, 60%)`; };
const getInitial = (email: string): string => email.split('@')[0].substring(0, 2).toUpperCase();

const findParentId = (nodes: Y.Map<any>, childId: string): string | null => {
  let result: string | null = null;
  nodes.forEach((value: any, key: string) => { if (value.children?.includes(childId)) result = key; });
  return result;
};

const findNodeAtPoint = (root: MindNode, x: number, y: number, excludeId?: string): MindNode | null => {
  if (excludeId && root.id === excludeId) return null;
  const stack = [root];
  while (stack.length) {
    const node = stack.pop()!;
    const left = node.x - NODE_WIDTH / 2 - 15, top = node.y - NODE_HEIGHT / 2 - 15;
    if (x >= left && x <= left + NODE_WIDTH + 30 && y >= top && y <= top + NODE_HEIGHT + 30 && node.id !== excludeId) return node;
    for (const c of node.children) stack.push(c);
  }
  return null;
};

const findNodeById = (root: MindNode, id: string): MindNode | null => {
  if (root.id === id) return root;
  for (const c of root.children) { const found = findNodeById(c, id); if (found) return found; }
  return null;
};

const getNodeDisplayPos = (nodeId: string, mindMap: MindNode | null, dragPositions: Record<string, { x: number; y: number }>, draggingNodeId: string | null): { x: number; y: number } | null => {
  if (!mindMap) return null;
  const node = findNodeById(mindMap, nodeId);
  if (!node) return null;
  if (nodeId === draggingNodeId && dragPositions[nodeId]) return dragPositions[nodeId];
  return { x: node.x, y: node.y };
};

const getCanvasCoords = (clientX: number, clientY: number, container: HTMLDivElement, zoomLevel: number): { x: number; y: number } => {
  const rect = container.getBoundingClientRect();
  return {
    x: (clientX - rect.left + container.scrollLeft) / zoomLevel,
    y: (clientY - rect.top + container.scrollTop) / zoomLevel,
  };
};

const isNodeInRect = (node: MindNode, rect: { x1: number; y1: number; x2: number; y2: number }): boolean => {
  const left = node.x - NODE_WIDTH / 2, right = node.x + NODE_WIDTH / 2, top = node.y - NODE_HEIGHT / 2, bottom = node.y + NODE_HEIGHT / 2;
  const rx1 = Math.min(rect.x1, rect.x2), rx2 = Math.max(rect.x1, rect.x2), ry1 = Math.min(rect.y1, rect.y2), ry2 = Math.max(rect.y1, rect.y2);
  return !(right < rx1 || left > rx2 || bottom < ry1 || top > ry2);
};

// --------------------- 認証画面 ---------------------
const AuthScreen = () => (
  <div className="flex items-center justify-center h-screen bg-gray-100">
    <div className="bg-white p-6 rounded shadow-md text-center">
      <h2 className="text-lg font-bold mb-4">マインドマップにログイン</h2>
      <button onClick={() => supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } })} className="bg-white border border-gray-300 rounded-lg py-2 px-4 flex items-center gap-2 hover:bg-gray-50">Googleでログイン</button>
    </div>
  </div>
);

// --------------------- メイン ---------------------
const App = () => {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => { setUser(session?.user ?? null); setLoading(false); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => listener.subscription.unsubscribe();
  }, []);
  if (loading) return <div className="flex items-center justify-center h-screen">Loading...</div>;
  if (!user) return <AuthScreen />;
  return <MindMapApp user={user} />;
};

// --------------------- 共同編集マインドマップ ---------------------
const MindMapApp = ({ user }: { user: any }) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mapId, setMapId] = useState<number | null>(null);
  const [mapTitle, setMapTitle] = useState('無題のマップ');
  const [roomId, setRoomId] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState('');
  const [savedMaps, setSavedMaps] = useState<MapRecord[]>([]);
  const [showLoadMenu, setShowLoadMenu] = useState(false);

  const [edgeStyle, setEdgeStyle] = useState<EdgeStyle>('bezier');

  const ydocRef = useRef<Y.Doc | null>(null);
  const yNodesRef = useRef<Y.Map<any> | null>(null);
  const yEdgesRef = useRef<Y.Map<any> | null>(null);
  const yImagesRef = useRef<Y.Map<any> | null>(null);
  const yRootRef = useRef<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const undoManagerRef = useRef<Y.UndoManager | null>(null);

  const [mindMap, setMindMap] = useState<MindNode | null>(null);
  const [edges, setEdges] = useState<EdgeData[]>([]);
  const [images, setImages] = useState<ImageData[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  const [dragPositions, setDragPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [dragTargetNodeId, setDragTargetNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [editingEdgeEndpoint, setEditingEdgeEndpoint] = useState<{ edgeId: string; endpoint: 'source' | 'target' } | null>(null);
  const [drawingEdge, setDrawingEdge] = useState<{ sourceNodeId: string; sourcePoint: ConnectionPoint; currentX: number; currentY: number; targetNodeId?: string; targetPoint?: ConnectionPoint } | null>(null);

  const [showColorPalette, setShowColorPalette] = useState<{ nodeId: string; x: number; y: number } | null>(null);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [draggingImageId, setDraggingImageId] = useState<string | null>(null);
  const [resizingImageHandle, setResizingImageHandle] = useState<{ imageId: string; handle: string } | null>(null);
  const imageDragOffset = useRef({ x: 0, y: 0 });

  const [selectionRect, setSelectionRect] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const wasDraggingRef = useRef(false);
  const groupDragStartMouse = useRef({ x: 0, y: 0 });
  const initialGroupDragPositions = useRef<Record<string, { x: number; y: number }>>({});
  const isMultiDragging = selectedNodeIds.length > 1 && Object.keys(dragPositions).length > 0;

  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [isCanvasPanning, setIsCanvasPanning] = useState(false);
  const panStartCoords = useRef({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });

  const addLog = (msg: string) => { if (import.meta.env.DEV) console.log(`[MindMap] ${msg}`); };
  const [connectionStatus, setConnectionStatus] = useState('接続中...');
  const [awarenessStates, setAwarenessStates] = useState<Record<string, AwarenessState>>({});
  const [showParticipants, setShowParticipants] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const myUserId = user.id;
  const myEmail = user.email;
  const myColor = stringToColor(myEmail);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1.0);
  const [zenMode, setZenMode] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuInfo>({ visible: false, x: 0, y: 0, type: 'canvas' });

  const closeContextMenu = useCallback(() => { setContextMenu(prev => ({ ...prev, visible: false })); setShowColorPalette(null); }, []);

  const scrollToHome = useCallback(() => {
    const container = scrollContainerRef.current; if (!container) return;
    const centerX = 5000 * zoomLevel - container.clientWidth / 2;
    const centerY = 5000 * zoomLevel - container.clientHeight / 2;
    container.scrollTo({ left: centerX, top: centerY, behavior: 'smooth' });
  }, [zoomLevel]);

  const broadcastAwareness = useCallback((channel: RealtimeChannel, userId: string, state: AwarenessState | null) => { if (!channel) return; channel.send({ type: 'broadcast', event: 'awareness-update', payload: { userId, state } }); }, []);

  const setZoomWithAnchor = useCallback((newZoom: number, clientX: number, clientY: number) => {
    const container = scrollContainerRef.current; if (!container) return;
    newZoom = Math.min(3.0, Math.max(0.1, newZoom));
    if (newZoom === zoomLevel) return;
    const rect = container.getBoundingClientRect();
    const mouseX = clientX - rect.left;
    const mouseY = clientY - rect.top;
    const logicalX = (mouseX + container.scrollLeft) / zoomLevel;
    const logicalY = (mouseY + container.scrollTop) / zoomLevel;
    setZoomLevel(newZoom);
    requestAnimationFrame(() => { container.scrollLeft = logicalX * newZoom - mouseX; container.scrollTop = logicalY * newZoom - mouseY; });
  }, [zoomLevel]);

  const changeZoom = useCallback((delta: number) => {
    const container = scrollContainerRef.current; if (!container) return;
    const rect = container.getBoundingClientRect();
    const clientX = rect.left + container.clientWidth / 2;
    const clientY = rect.top + container.clientHeight / 2;
    setZoomWithAnchor(zoomLevel + delta, clientX, clientY);
  }, [zoomLevel, setZoomWithAnchor]);

  useEffect(() => {
    const container = scrollContainerRef.current; if (!container) return;
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); const delta = e.deltaY > 0 ? -0.1 : 0.1; const zoomDelta = Math.abs(e.deltaY) < 50 ? delta * 0.5 : delta; setZoomWithAnchor(zoomLevel + zoomDelta, e.clientX, e.clientY); }
      else if (isSpacePressed) { e.preventDefault(); }
    };
    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [zoomLevel, isSpacePressed, setZoomWithAnchor]);

  useEffect(() => {
    const handleGlobalKeyDown = (e: globalThis.KeyboardEvent) => { if (e.code === 'Space' && !editingNodeId && document.activeElement?.tagName !== 'INPUT') { e.preventDefault(); setIsSpacePressed(true); } };
    const handleGlobalKeyUp = (e: globalThis.KeyboardEvent) => { if (e.code === 'Space') { setIsSpacePressed(false); setIsCanvasPanning(false); } };
    window.addEventListener('keydown', handleGlobalKeyDown); window.addEventListener('keyup', handleGlobalKeyUp);
    return () => { window.removeEventListener('keydown', handleGlobalKeyDown); window.removeEventListener('keyup', handleGlobalKeyUp); };
  }, [editingNodeId]);

  const addEdge = useCallback((sourceNodeId: string, sourcePoint: ConnectionPoint, targetNodeId: string, targetPoint: ConnectionPoint) => { const yEdges = yEdgesRef.current; if (!yEdges || !ydocRef.current) return; const edgeId = crypto.randomUUID(); ydocRef.current.transact(() => { yEdges.set(edgeId, { sourceNodeId, sourcePoint, targetNodeId, targetPoint, arrow: 'none' }); }); }, []);

  const deleteEdge = useCallback((edgeId: string) => {
    if (edgeId.startsWith('parent-edge-')) {
      const childId = edgeId.replace('parent-edge-', '');
      const nodes = yNodesRef.current;
      const rootId = yRootRef.current;
      if (!nodes || !rootId) return;
      ydocRef.current?.transact(() => {
        const childNode = nodes.get(childId);
        const parentId = findParentId(nodes, childId);
        const rootNode = nodes.get(rootId);
        if (childNode && rootNode && parentId) {
          if (parentId !== rootId) {
            const parentNode = nodes.get(parentId);
            if (parentNode) {
              nodes.set(parentId, { ...parentNode, children: (parentNode.children as string[]).filter(id => id !== childId) });
            }
            nodes.set(childId, { ...childNode, independent: true });
            nodes.set(rootId, { ...rootNode, children: [...(rootNode.children as string[]), childId] });
          } else {
            nodes.set(childId, { ...childNode, independent: true });
          }
        }
      });
      setSelectedEdgeId(null);
      closeContextMenu();
      return;
    }
    const yEdges = yEdgesRef.current; if (!yEdges) return; ydocRef.current?.transact(() => { yEdges.delete(edgeId); }); setSelectedEdgeId(null); closeContextMenu();
  }, [closeContextMenu]);

  const updateEdgeEndpoint = useCallback((edgeId: string, endpoint: 'source' | 'target', point: ConnectionPoint) => { const yEdges = yEdgesRef.current; if (!yEdges) return; const edge = yEdges.get(edgeId); if (!edge) return; ydocRef.current?.transact(() => { if (endpoint === 'source') yEdges.set(edgeId, { ...edge, sourcePoint: point }); else yEdges.set(edgeId, { ...edge, targetPoint: point }); }); }, []);
  const updateEdgeArrow = useCallback((edgeId: string, arrow: 'none' | 'start' | 'end' | 'both') => { const yEdges = yEdgesRef.current; if (!yEdges) return; const edge = yEdges.get(edgeId); if (!edge) return; ydocRef.current?.transact(() => { yEdges.set(edgeId, { ...edge, arrow }); }); }, []);

  const reparentNode = useCallback((nodeId: string, newParentId: string) => {
    const nodes = yNodesRef.current; if (!nodes || !yRootRef.current || nodeId === yRootRef.current) return;
    const oldParentId = findParentId(nodes, nodeId); if (!oldParentId || oldParentId === newParentId) return;
    const oldParent = nodes.get(oldParentId), newParent = nodes.get(newParentId); if (!oldParent || !newParent) return;
    ydocRef.current?.transact(() => {
      nodes.set(oldParentId, { ...oldParent, children: (oldParent.children as string[]).filter(id => id !== nodeId) });
      const nodeData = nodes.get(nodeId); nodes.set(nodeId, { ...nodeData, independent: false });
      nodes.set(newParentId, { ...newParent, children: [...(newParent.children as string[]), nodeId] });
    });
  }, []);

  const addChildNode = useCallback((parentId: string) => {
    const nodes = yNodesRef.current; if (!nodes) return; const parent = nodes.get(parentId); if (!parent) return;
    const childId = crypto.randomUUID();
    const idealX = parent.x + NODE_WIDTH + 40;
    const idealY = parent.y;
    const safePos = getUnoccupiedPosition(idealX, idealY, nodes);

    ydocRef.current?.transact(() => {
      nodes.set(childId, { text: '新しいトピック', x: safePos.x, y: safePos.y, children: [], independent: false, bgColor: '#f0f9ff', textColor: '#0369a1' });
      nodes.set(parentId, { ...parent, children: [...(parent.children ?? []), childId] });
    });
    setSelectedNodeId(childId); setSelectedNodeIds([childId]);
  }, []);

  const addSiblingNode = useCallback((targetId: string, position: 'before' | 'after') => {
    const nodes = yNodesRef.current; if (!nodes || !yRootRef.current) return; if (targetId === yRootRef.current) return;
    const parentId = findParentId(nodes, targetId); if (!parentId) return; const parent = nodes.get(parentId); if (!parent) return;
    const siblingId = crypto.randomUUID(); const targetNode = nodes.get(targetId);

    const idealX = targetNode ? targetNode.x : parent.x + NODE_WIDTH + 40;
    const idealY = targetNode ? targetNode.y + (position === 'after' ? (NODE_HEIGHT + 20) : -(NODE_HEIGHT + 20)) : parent.y;
    const safePos = getUnoccupiedPosition(idealX, idealY, nodes);

    const curChildren: string[] = parent.children ?? []; const targetIndex = curChildren.indexOf(targetId); const newChildren = [...curChildren];
    newChildren.splice(position === 'before' ? targetIndex : targetIndex + 1, 0, siblingId);
    ydocRef.current?.transact(() => {
      nodes.set(siblingId, { text: '新しいトピック', x: safePos.x, y: safePos.y, children: [], independent: false, bgColor: '#f0f9ff', textColor: '#0369a1' });
      nodes.set(parentId, { ...parent, children: newChildren });
    });
    setSelectedNodeId(siblingId); setSelectedNodeIds([siblingId]);
  }, []);

  const addParentNode = useCallback((targetId: string) => {
    const nodes = yNodesRef.current; if (!nodes || !yRootRef.current) return; if (targetId === yRootRef.current) return;
    const oldParentId = findParentId(nodes, targetId); if (!oldParentId) return; const oldParent = nodes.get(oldParentId); if (!oldParent) return;
    const targetNode = nodes.get(targetId); if (!targetNode) return;

    const newParentId = crypto.randomUUID();
    const idealX = targetNode.x - NODE_WIDTH - 40;
    const idealY = targetNode.y;
    const safePos = getUnoccupiedPosition(idealX, idealY, nodes);

    ydocRef.current?.transact(() => {
      nodes.set(newParentId, { text: '新しいトピック', x: safePos.x, y: safePos.y, children: [targetId], independent: false, bgColor: '#f0f9ff', textColor: '#0369a1' });
      const updatedOldChildren = (oldParent.children ?? []).filter(id => id !== targetId); updatedOldChildren.push(newParentId);
      nodes.set(oldParentId, { ...oldParent, children: updatedOldChildren });
    });
    setSelectedNodeId(newParentId); setSelectedNodeIds([newParentId]);
  }, []);

  const addNodeAtPosition = useCallback((x: number, y: number) => {
    const nodes = yNodesRef.current, rootId = yRootRef.current; if (!nodes || !rootId) return;
    const childId = crypto.randomUUID();
    const safePos = getUnoccupiedPosition(x, y, nodes);

    ydocRef.current?.transact(() => {
      nodes.set(childId, { text: '独立トピック', x: safePos.x, y: safePos.y, children: [], independent: true, bgColor: '#f0f9ff', textColor: '#0369a1' });
      const root = nodes.get(rootId); if (root) nodes.set(rootId, { ...root, children: [...(root.children ?? []), childId] });
    });
    setSelectedNodeId(childId); setSelectedNodeIds([childId]);
  }, []);

  const deleteNode = useCallback((nodeId: string) => {
    const nodes = yNodesRef.current; if (!nodes || !yRootRef.current || nodeId === yRootRef.current) return;
    ydocRef.current?.transact(() => {
      nodes.forEach((value: any, key: string) => { if (value.children?.includes(nodeId)) nodes.set(key, { ...value, children: value.children.filter((id: string) => id !== nodeId) }); });
      nodes.delete(nodeId);
    });
    setSelectedNodeId(null); setSelectedNodeIds([]);
  }, []);

  const updateText = useCallback((nodeId: string, text: string) => { const nodes = yNodesRef.current; if (!nodes) return; const data = nodes.get(nodeId); if (data) nodes.set(nodeId, { ...data, text }); }, []);
  const updatePosition = useCallback((nodeId: string, x: number, y: number) => { const nodes = yNodesRef.current; if (!nodes) return; const data = nodes.get(nodeId); if (data) nodes.set(nodeId, { ...data, x, y }); }, []);
  const updateNodeColors = useCallback((nodeId: string, bgColor: string, textColor: string) => { const nodes = yNodesRef.current; if (!nodes) return; const data = nodes.get(nodeId); if (data) nodes.set(nodeId, { ...data, bgColor, textColor }); }, []);

  const alignNodes = useCallback((axis: 'vertical' | 'horizontal') => {
    const nodes = yNodesRef.current; if (!nodes || selectedNodeIds.length < 2) return;
    const refNodeId = selectedNodeIds[0]; const refNode = nodes.get(refNodeId); if (!refNode) return;
    const targetX = axis === 'vertical' ? refNode.x : undefined; const targetY = axis === 'horizontal' ? refNode.y : undefined;
    const idsToAlign = selectedNodeIds.slice(1);
    ydocRef.current?.transact(() => { idsToAlign.forEach(id => { const data = nodes.get(id); if (!data) return; const updated = { ...data }; if (targetX !== undefined) updated.x = targetX; if (targetY !== undefined) updated.y = targetY; nodes.set(id, updated); }); });
  }, [selectedNodeIds]);

  const handleImageUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const fileExt = file.name.split('.').pop(); const fileName = `${crypto.randomUUID()}.${fileExt}`;
    const { data, error } = await supabase.storage.from('images').upload(fileName, file);
    if (error) { alert('画像のアップロードに失敗しました'); return; }
    const path = data.path; const img = new Image(); img.src = URL.createObjectURL(file);
    img.onload = () => {
      const yImages = yImagesRef.current; if (!yImages || !ydocRef.current) return;
      const imageId = crypto.randomUUID(); const container = scrollContainerRef.current;
      const centerX = container ? container.scrollLeft + container.clientWidth / 2 : 5000;
      const centerY = container ? container.scrollTop + container.clientHeight / 2 : 5000;
      ydocRef.current.transact(() => { yImages.set(imageId, { storagePath: path, x: centerX - img.width / 2, y: centerY - img.height / 2, width: img.width, height: img.height }); });
    };
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const deleteImage = useCallback((imageId: string) => {
    const yImages = yImagesRef.current; if (!yImages) return;
    const image = yImages.get(imageId);
    if (image) { supabase.storage.from('images').remove([image.storagePath]); }
    ydocRef.current?.transact(() => { yImages.delete(imageId); });
    setSelectedImageId(null); closeContextMenu();
  }, [closeContextMenu]);

  const updateImagePosition = useCallback((imageId: string, x: number, y: number) => { const yImages = yImagesRef.current; if (!yImages) return; const data = yImages.get(imageId); if (data) yImages.set(imageId, { ...data, x, y }); }, []);

  // initYjs
  const initYjs = (room: string, initialTree?: MindNode): RealtimeChannel => {
    addLog(`initYjs: ${room}`);
    if (channelRef.current) { supabase.removeChannel(channelRef.current); channelRef.current = null; }
    ydocRef.current?.destroy(); if (undoManagerRef.current) { undoManagerRef.current.destroy(); undoManagerRef.current = null; }
    setConnectionStatus('接続中...'); setCanUndo(false); setCanRedo(false); setIsDirty(false);
    const ydoc = new Y.Doc(); ydocRef.current = ydoc;
    const yNodes = ydoc.getMap('nodes'); yNodesRef.current = yNodes;
    const yEdges = ydoc.getMap('edges'); yEdgesRef.current = yEdges;
    const yImages = ydoc.getMap('images'); yImagesRef.current = yImages;
    if (initialTree) { treeToYMap(initialTree, yNodes); yRootRef.current = initialTree.id; }
    else { const rootId = crypto.randomUUID(); yNodes.set(rootId, { text: '中心テーマ', x: 5000, y: 5000, children: [], independent: false, bgColor: '#f0f9ff', textColor: '#0369a1' }); yRootRef.current = rootId; }
    const updateReact = () => {
      if (yRootRef.current) { const tree = yMapToTree(yNodes, yRootRef.current); if (tree) setMindMap(tree); }
      const edgeList: EdgeData[] = [];
      yEdges.forEach((value: any, key: string) => {
        edgeList.push({ id: key, sourceNodeId: value.sourceNodeId, sourcePoint: value.sourcePoint, targetNodeId: value.targetNodeId, targetPoint: value.targetPoint, arrow: value.arrow ?? 'none' });
      });
      setEdges(edgeList);
      const imageList: ImageData[] = [];
      yImages.forEach((value: any, key: string) => {
        imageList.push({ id: key, storagePath: value.storagePath, x: value.x, y: value.y, width: value.width, height: value.height });
      });
      setImages(imageList);
    };
    yNodes.observe(updateReact); yEdges.observe(updateReact); yImages.observe(updateReact); updateReact();
    const undoManager = new Y.UndoManager([yNodes, yEdges, yImages]); undoManagerRef.current = undoManager;
    const updateUndoRedoState = () => { setCanUndo(undoManager.undoStack.length > 0); setCanRedo(undoManager.redoStack.length > 0); };
    undoManager.on('stack-item-added', updateUndoRedoState); undoManager.on('stack-item-popped', updateUndoRedoState); updateUndoRedoState();
    const channel = supabase.channel(`map-${room}`, { config: { broadcast: { ack: false } } });
    ydoc.on('update', (update: Uint8Array, origin: any) => {
      try { localStorage.setItem(`mindmap-draft-${room}`, uint8ArrayToBase64(Y.encodeStateAsUpdate(ydoc))); } catch(e) {}
      setIsDirty(true); if (origin === 'supabase' || origin === 'local') return;
      channel.send({ type: 'broadcast', event: 'yjs-update', payload: { update: uint8ArrayToBase64(update) } });
    });
    try { const draft = localStorage.getItem(`mindmap-draft-${room}`); if (draft) { Y.applyUpdate(ydoc, base64ToUint8Array(draft), 'local'); addLog('未保存のバックアップを復元'); setIsDirty(true); } } catch(e) {}
    channel.on('broadcast', { event: 'yjs-update' }, (msg: any) => { const update = base64ToUint8Array(msg.payload.update); Y.applyUpdate(ydoc, update, 'supabase'); });
    channel.on('broadcast', { event: 'sync-step-1' }, (msg: any) => { const stateVector = base64ToUint8Array(msg.payload.stateVector); const update = Y.encodeStateAsUpdate(ydoc, stateVector); if (update.byteLength > 10) channel.send({ type: 'broadcast', event: 'sync-step-2', payload: { update: uint8ArrayToBase64(update) } }); });
    channel.on('broadcast', { event: 'sync-step-2' }, (msg: any) => { Y.applyUpdate(ydoc, base64ToUint8Array(msg.payload.update), 'supabase'); addLog('差分同期完了'); });
    channel.on('broadcast', { event: 'awareness-update' }, (msg: any) => { const { userId, state } = msg.payload; if (userId === myUserId) return; if (state === null) setAwarenessStates(prev => { const { [userId]: _, ...rest } = prev; return rest; }); else setAwarenessStates(prev => ({ ...prev, [userId]: state })); });
    const removeSelf = () => channel.send({ type: 'broadcast', event: 'awareness-update', payload: { userId: myUserId, state: null } }); window.addEventListener('beforeunload', removeSelf);
    channel.subscribe((status: string, err: any) => {
      if (status === 'SUBSCRIBED') setConnectionStatus('接続済み'); else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') setConnectionStatus('切断'); else if (status === 'TIMED_OUT') setConnectionStatus('タイムアウト'); else setConnectionStatus('接続中...');
      if (err) console.error('Supabase Error:', err);
      if (status === 'SUBSCRIBED') { channel.send({ type: 'broadcast', event: 'sync-step-1', payload: { stateVector: uint8ArrayToBase64(Y.encodeStateVector(ydoc)) } }); broadcastAwareness(channel, myUserId, { email: myEmail, color: myColor, selectedNodeId, editingNodeId }); }
    });
    channelRef.current = channel; setRoomId(room); return channel;
  };

  useEffect(() => {
    let isMounted = true; let localChannel: RealtimeChannel | null = null;
    const setup = async () => {
      const hash = window.location.hash.slice(1); let roomToJoin = hash;
      if (!hash) { roomToJoin = crypto.randomUUID(); window.history.replaceState(null, '', `#${roomToJoin}`); }
      if (hash) { const { data, error } = await supabase.from('maps').select('*').eq('room_id', hash).single(); if (!isMounted) return; if (error || !data) { localChannel = initYjs(roomToJoin); setMapId(null); setMapTitle('無題のマップ'); } else { setMapId(data.id); setMapTitle(data.title); localChannel = initYjs(roomToJoin, data.data as MindNode); } }
      else { if (!isMounted) return; localChannel = initYjs(roomToJoin); setMapId(null); setMapTitle('無題のマップ'); }
    };
    setup();
    return () => { isMounted = false; if (localChannel) supabase.removeChannel(localChannel); else if (channelRef.current) supabase.removeChannel(channelRef.current); if (channelRef.current) broadcastAwareness(channelRef.current, myUserId, null); };
  }, []);

  const initialScrollDone = useRef(false);
  useEffect(() => { if (mindMap && !initialScrollDone.current) { requestAnimationFrame(() => { scrollToHome(); initialScrollDone.current = true; }); } }, [mindMap, scrollToHome]);
  useEffect(() => { if (!channelRef.current || !roomId) return; broadcastAwareness(channelRef.current, myUserId, { email: myEmail, color: myColor, selectedNodeId, editingNodeId }); }, [selectedNodeId, editingNodeId, myUserId, myEmail, myColor, roomId, broadcastAwareness]);

  const handleUndo = useCallback(() => { if (undoManagerRef.current) undoManagerRef.current.undo(); }, []);
  const handleRedo = useCallback(() => { if (undoManagerRef.current) undoManagerRef.current.redo(); }, []);
  const handleLogout = async () => { if (channelRef.current) { broadcastAwareness(channelRef.current, myUserId, null); supabase.removeChannel(channelRef.current); } ydocRef.current?.destroy(); if (undoManagerRef.current) undoManagerRef.current.destroy(); await supabase.auth.signOut(); };

  const handleSave = async () => {
    if (!yNodesRef.current || !yRootRef.current || !roomId) return;
    const tree = yMapToTree(yNodesRef.current, yRootRef.current); if (!tree) return;
    setSaveMessage('');
    const payload = { title: mapTitle, data: tree, room_id: roomId, user_id: user.id, updated_at: new Date().toISOString() };
    const { data, error } = mapId ? await supabase.from('maps').update({ title: mapTitle, data: tree, updated_at: payload.updated_at }).eq('id', mapId).select() : await supabase.from('maps').insert([payload]).select();
    if (error) { setSaveMessage('保存に失敗'); return; }
    if (data && data.length > 0) { setMapId(data[0].id); setSaveMessage('保存完了'); setIsDirty(false); try { localStorage.setItem(`mindmap-draft-${roomId}`, uint8ArrayToBase64(Y.encodeStateAsUpdate(ydocRef.current!))); } catch(e) {} setTimeout(() => setSaveMessage(''), 2500); }
  };

  const fetchMaps = async () => { const { data } = await supabase.from('maps').select('*').eq('user_id', user.id).order('created_at', { ascending: false }); if (data) setSavedMaps(data as MapRecord[]); };
  const handleLoadMap = (map: MapRecord) => { if (channelRef.current) supabase.removeChannel(channelRef.current); window.location.hash = map.room_id; setMapId(map.id); setMapTitle(map.title); initYjs(map.room_id, map.data); setShowLoadMenu(false); };
  const handleNewMap = () => { if (channelRef.current) supabase.removeChannel(channelRef.current); const newRoom = crypto.randomUUID(); window.location.hash = newRoom; initYjs(newRoom); setMapId(null); setMapTitle('無題のマップ'); };
  const handleShare = () => { if (!roomId) return; navigator.clipboard.writeText(`${window.location.origin}#${roomId}`); alert('共有URLをコピーしました！'); };

  const handleMouseDownOnNode = useCallback((e: ReactMouseEvent, nodeId: string) => {
    if (e.button !== 0 || isSpacePressed) return; e.stopPropagation();
    const container = scrollContainerRef.current; if (!container) return;
    const coords = getCanvasCoords(e.clientX, e.clientY, container, zoomLevel);
    const node = mindMap ? findNodeById(mindMap, nodeId) : null; if (!node) return;
    const isMulti = selectedNodeIds.length > 1 && selectedNodeIds.includes(nodeId);
    if (isMulti) {
      groupDragStartMouse.current = { x: coords.x, y: coords.y };
      const initialPositions: Record<string, { x: number; y: number }> = {};
      selectedNodeIds.forEach(id => { const n = findNodeById(mindMap, id); if (n) initialPositions[id] = { x: n.x, y: n.y }; });
      initialGroupDragPositions.current = initialPositions;
      setDragPositions(initialPositions);
      setDraggingNodeId(null); setDragTargetNodeId(null); setSelectedEdgeId(null); setSelectedImageId(null);
    } else {
      dragOffset.current = { x: coords.x - node.x, y: coords.y - node.y };
      setDragPositions(prev => ({ ...prev, [nodeId]: { x: node.x, y: node.y } }));
      setDraggingNodeId(nodeId); setDragTargetNodeId(null); setSelectedEdgeId(null); setSelectedImageId(null);
    }
  }, [mindMap, zoomLevel, selectedNodeIds, isSpacePressed]);

  const handleMouseDownOnImage = useCallback((e: ReactMouseEvent, imageId: string) => {
    if (e.button !== 0 || isSpacePressed) return; e.stopPropagation();
    const image = images.find(img => img.id === imageId); if (!image) return;
    const container = scrollContainerRef.current; if (!container) return;
    const coords = getCanvasCoords(e.clientX, e.clientY, container, zoomLevel);
    imageDragOffset.current = { x: coords.x - image.x, y: coords.y - image.y };
    setDraggingImageId(imageId); setSelectedImageId(imageId); setSelectedNodeId(null); setSelectedEdgeId(null);
  }, [images, zoomLevel, isSpacePressed]);

  const handleResizeHandleMouseDown = useCallback((e: ReactMouseEvent, imageId: string, handle: string) => { e.stopPropagation(); e.preventDefault(); setResizingImageHandle({ imageId, handle }); }, []);

  const handleCanvasMouseDown = useCallback((e: ReactMouseEvent) => {
    if (e.button !== 0) return;
    const container = scrollContainerRef.current; if (!container) return;
    if (isSpacePressed) {
      e.preventDefault(); setIsCanvasPanning(true);
      panStartCoords.current = { x: e.clientX, y: e.clientY, scrollLeft: container.scrollLeft, scrollTop: container.scrollTop };
      return;
    }
    const coords = getCanvasCoords(e.clientX, e.clientY, container, zoomLevel);
    const nodeUnder = mindMap ? findNodeAtPoint(mindMap, coords.x, coords.y) : null;

    if (!nodeUnder) {
      setSelectedNodeId(null);
      setSelectedNodeIds([]);
      setSelectedEdgeId(null);
      setSelectedImageId(null);
      closeContextMenu();

      wasDraggingRef.current = true;
      setSelectionRect({ x1: coords.x, y1: coords.y, x2: coords.x, y2: coords.y });
    }
  }, [mindMap, zoomLevel, isSpacePressed, closeContextMenu]);

  const handleCanvasDoubleClick = useCallback((e: ReactMouseEvent) => {
    if (e.button !== 0 || isSpacePressed) return;
    const container = scrollContainerRef.current; if (!container) return;
    const coords = getCanvasCoords(e.clientX, e.clientY, container, zoomLevel);
    const nodeUnder = mindMap ? findNodeAtPoint(mindMap, coords.x, coords.y) : null;
    if (!nodeUnder) {
      addNodeAtPosition(coords.x, coords.y);
    }
  }, [mindMap, zoomLevel, isSpacePressed, addNodeAtPosition]);

  const handleMouseMove = useCallback((e: MouseEvent | ReactMouseEvent) => {
    const container = scrollContainerRef.current; if (!container) return;
    if (isCanvasPanning) { const dx = e.clientX - panStartCoords.current.x, dy = e.clientY - panStartCoords.current.y; container.scrollLeft = panStartCoords.current.scrollLeft - dx; container.scrollTop = panStartCoords.current.scrollTop - dy; return; }
    const coords = getCanvasCoords(e.clientX, e.clientY, container, zoomLevel);

    if (editingEdgeEndpoint) {
      const { edgeId, endpoint } = editingEdgeEndpoint; const edge = edges.find(eg => eg.id === edgeId); if (!edge) return;
      const nodeId = endpoint === 'source' ? edge.sourceNodeId : edge.targetNodeId; const node = mindMap ? findNodeById(mindMap, nodeId) : null; if (!node) return;
      const pos = getNodeDisplayPos(nodeId, mindMap, dragPositions, draggingNodeId) || { x: node.x, y: node.y };
      const closestPoint = findClosestConnectionPoint(pos.x, pos.y, coords.x, coords.y); updateEdgeEndpoint(edgeId, endpoint, closestPoint); return;
    }
    if (drawingEdge) {
      const nodeUnder = mindMap ? findNodeAtPoint(mindMap, coords.x, coords.y, drawingEdge.sourceNodeId) : null;
      if (nodeUnder) {
        const pt = findClosestConnectionPoint(nodeUnder.x, nodeUnder.y, coords.x, coords.y);
        const snappedCoords = getConnectionPoint(nodeUnder.x, nodeUnder.y, pt);
        setDrawingEdge(prev => prev ? { ...prev, currentX: snappedCoords.x, currentY: snappedCoords.y, targetNodeId: nodeUnder.id, targetPoint: pt } : null);
      } else {
        setDrawingEdge(prev => prev ? { ...prev, currentX: coords.x, currentY: coords.y, targetNodeId: undefined, targetPoint: undefined } : null);
      }
      return;
    }
    if (draggingImageId) { updateImagePosition(draggingImageId, coords.x - imageDragOffset.current.x, coords.y - imageDragOffset.current.y); return; }
    if (resizingImageHandle) {
      const image = images.find(img => img.id === resizingImageHandle.imageId); if (!image) return;
      let newWidth = image.width, newHeight = image.height, newX = image.x, newY = image.y; const h = resizingImageHandle.handle;
      if (h.includes('e')) newWidth = Math.max(20, coords.x - image.x); if (h.includes('s')) newHeight = Math.max(20, coords.y - image.y);
      if (h.includes('w')) { const diff = image.x - coords.x; newWidth = Math.max(20, diff); newX = coords.x; }
      if (h.includes('n')) { const diff = image.y - coords.y; newHeight = Math.max(20, diff); newY = coords.y; }
      const yImages = yImagesRef.current; if (yImages) { ydocRef.current?.transact(() => { yImages.set(image.id, { ...image, width: newWidth, height: newHeight, x: newX, y: newY }); }); }
      return;
    }
    if (selectionRect) { setSelectionRect(prev => prev ? { ...prev, x2: coords.x, y2: coords.y } : null); return; }
    if (draggingNodeId) {
      const newX = coords.x - dragOffset.current.x, newY = coords.y - dragOffset.current.y;
      setDragPositions(prev => ({ ...prev, [draggingNodeId]: { x: newX, y: newY } }));
      if (mindMap) { const target = findNodeAtPoint(mindMap, coords.x, coords.y, draggingNodeId); setDragTargetNodeId(target && target.id !== draggingNodeId ? target.id : null); }
      return;
    }
    if (selectedNodeIds.length > 1 && Object.keys(dragPositions).length > 0) {
      const deltaX = coords.x - groupDragStartMouse.current.x, deltaY = coords.y - groupDragStartMouse.current.y;
      const newPositions: Record<string, { x: number; y: number }> = {};
      selectedNodeIds.forEach(id => { const initial = initialGroupDragPositions.current[id]; if (initial) newPositions[id] = { x: initial.x + deltaX, y: initial.y + deltaY }; });
      setDragPositions(newPositions); return;
    }
  }, [editingEdgeEndpoint, drawingEdge, draggingImageId, resizingImageHandle, selectionRect, draggingNodeId, selectedNodeIds, dragPositions, mindMap, edges, updateEdgeEndpoint, zoomLevel, updateImagePosition, images, isCanvasPanning]);

  const handleMouseUp = useCallback(() => {
    if (isCanvasPanning) { setIsCanvasPanning(false); return; }
    if (editingEdgeEndpoint) { setEditingEdgeEndpoint(null); return; }
    if (drawingEdge) {
      if (!mindMap) return;
      if (drawingEdge.targetNodeId && drawingEdge.targetPoint) {
        addEdge(drawingEdge.sourceNodeId, drawingEdge.sourcePoint, drawingEdge.targetNodeId, drawingEdge.targetPoint);
      } else {
        const targetNode = findNodeAtPoint(mindMap, drawingEdge.currentX, drawingEdge.currentY, drawingEdge.sourceNodeId);
        if (targetNode) {
          const pt = findClosestConnectionPoint(targetNode.x, targetNode.y, drawingEdge.currentX, drawingEdge.currentY);
          addEdge(drawingEdge.sourceNodeId, drawingEdge.sourcePoint, targetNode.id, pt);
        }
      }
      setDrawingEdge(null); return;
    }
    if (draggingImageId) { setDraggingImageId(null); return; }
    if (resizingImageHandle) { setResizingImageHandle(null); return; }
    if (selectionRect) {
      if (mindMap) { const selectedIds: string[] = []; const collectNodes = (node: MindNode) => { if (isNodeInRect(node, selectionRect)) selectedIds.push(node.id); node.children.forEach(collectNodes); }; collectNodes(mindMap); if (selectedIds.length > 0) { setSelectedNodeId(selectedIds[0]); setSelectedNodeIds(selectedIds); } }
      setSelectionRect(null); return;
    }
    if (draggingNodeId) {
      const pos = dragPositions[draggingNodeId]; if (pos) updatePosition(draggingNodeId, pos.x, pos.y);
      if (dragTargetNodeId && dragTargetNodeId !== draggingNodeId) reparentNode(draggingNodeId, dragTargetNodeId);
      setDraggingNodeId(null); setDragTargetNodeId(null); setDragPositions(prev => { const { [draggingNodeId]: _, ...rest } = prev; return rest; }); return;
    }
    if (selectedNodeIds.length > 1 && Object.keys(dragPositions).length > 0) {
      const nodes = yNodesRef.current;
      if (nodes) { ydocRef.current?.transact(() => { selectedNodeIds.forEach(id => { const pos = dragPositions[id]; if (pos && nodes.get(id)) nodes.set(id, { ...nodes.get(id), x: pos.x, y: pos.y }); }); }); }
      setDragPositions({}); initialGroupDragPositions.current = {}; return;
    }
  }, [editingEdgeEndpoint, drawingEdge, draggingImageId, resizingImageHandle, selectionRect, draggingNodeId, dragPositions, dragTargetNodeId, selectedNodeIds, mindMap, addEdge, updatePosition, reparentNode, isCanvasPanning]);

  useEffect(() => {
    const isAnyDrag = draggingNodeId || editingEdgeEndpoint || drawingEdge || draggingImageId || resizingImageHandle || selectionRect || isCanvasPanning || (selectedNodeIds.length > 1 && Object.keys(dragPositions).length > 0);
    if (isAnyDrag) {
      window.addEventListener('mousemove', handleMouseMove as any); window.addEventListener('mouseup', handleMouseUp);
      return () => { window.removeEventListener('mousemove', handleMouseMove as any); window.removeEventListener('mouseup', handleMouseUp); };
    }
  }, [draggingNodeId, editingEdgeEndpoint, drawingEdge, draggingImageId, resizingImageHandle, selectionRect, selectedNodeIds, dragPositions, handleMouseMove, handleMouseUp, isCanvasPanning]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (editingNodeId) return;
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); handleSave(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); e.shiftKey ? handleRedo() : handleUndo(); return; }
    if (e.altKey && (e.ctrlKey || e.metaKey) && e.key === 'f') { e.preventDefault(); setZenMode(prev => !prev); return; }
    if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '-' || e.key === '=')) { e.preventDefault(); changeZoom(e.key === '-' ? -0.1 : 0.1); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedEdgeId && !selectedNodeId && !selectedImageId) { e.preventDefault(); deleteEdge(selectedEdgeId); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedImageId && !selectedNodeId && !selectedEdgeId) { e.preventDefault(); deleteImage(selectedImageId); return; }

    if (!selectedNodeId) return;

    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      const current = mindMap ? findNodeById(mindMap, selectedNodeId) : null;
      if (!current || !mindMap) return;

      let closest: MindNode | null = null;
      let minDist = Infinity;
      const allNodes = getAllNodes(mindMap);

      allNodes.forEach(n => {
        if (n.id === selectedNodeId) return;
        const dx = n.x - current.x;
        const dy = n.y - current.y;
        let valid = false;

        if (e.key === 'ArrowUp' && dy < -20 && Math.abs(dx) < Math.abs(dy)) valid = true;
        if (e.key === 'ArrowDown' && dy > 20 && Math.abs(dx) < Math.abs(dy)) valid = true;
        if (e.key === 'ArrowLeft' && dx < -20 && Math.abs(dy) < Math.abs(dx)) valid = true;
        if (e.key === 'ArrowRight' && dx > 20 && Math.abs(dy) < Math.abs(dx)) valid = true;

        if (valid) {
          const dist = Math.hypot(dx, dy);
          if (dist < minDist) { minDist = dist; closest = n; }
        }
      });

      if (closest) {
        setSelectedNodeId(closest.id);
        setSelectedNodeIds([closest.id]);
        const container = scrollContainerRef.current;
        if (container) {
          const rect = container.getBoundingClientRect();
          const viewLeft = container.scrollLeft / zoomLevel;
          const viewTop = container.scrollTop / zoomLevel;
          const viewRight = viewLeft + rect.width / zoomLevel;
          const viewBottom = viewTop + rect.height / zoomLevel;
          if (closest.x < viewLeft + 100 || closest.x > viewRight - 100 || closest.y < viewTop + 100 || closest.y > viewBottom - 100) {
            container.scrollTo({ left: closest.x * zoomLevel - rect.width / 2, top: closest.y * zoomLevel - rect.height / 2, behavior: 'smooth' });
          }
        }
      }
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); addSiblingNode(selectedNodeId, 'after'); return; }
    if (e.key === 'Enter' && e.shiftKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); addSiblingNode(selectedNodeId, 'before'); return; }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); addParentNode(selectedNodeId); return; }
    if (e.key === 'Tab') { e.preventDefault(); addChildNode(selectedNodeId); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteNode(selectedNodeId); return; }
  }, [editingNodeId, selectedNodeId, selectedEdgeId, selectedImageId, mindMap, zoomLevel, handleSave, handleUndo, handleRedo, addChildNode, addSiblingNode, addParentNode, deleteNode, deleteEdge, deleteImage, changeZoom]);

  const handleNodeContextMenu = useCallback((e: ReactMouseEvent, nodeId: string) => { e.preventDefault(); e.stopPropagation(); setContextMenu({ visible: true, x: e.clientX, y: e.clientY, type: 'node', nodeId }); setShowColorPalette(null); }, []);
  const handleCanvasContextMenu = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    const container = scrollContainerRef.current; if (!container) return;
    const coords = getCanvasCoords(e.clientX, e.clientY, container, zoomLevel);
    setContextMenu({ visible: true, x: e.clientX, y: e.clientY, type: 'canvas', canvasX: coords.x, canvasY: coords.y });
  }, [zoomLevel]);
  const handleImageContextMenu = useCallback((e: ReactMouseEvent, imageId: string) => { e.preventDefault(); e.stopPropagation(); setSelectedImageId(imageId); setContextMenu({ visible: true, x: e.clientX, y: e.clientY, type: 'image', imageId }); }, []);

  const executeContextAction = useCallback((action: string) => {
    closeContextMenu();
    if (contextMenu.type === 'node' && contextMenu.nodeId) {
      const nodeId = contextMenu.nodeId;
      switch (action) {
        case 'addChild': addChildNode(nodeId); break;
        case 'addSiblingAfter': addSiblingNode(nodeId, 'after'); break;
        case 'addSiblingBefore': addSiblingNode(nodeId, 'before'); break;
        case 'addParent': addParentNode(nodeId); break;
        case 'delete': deleteNode(nodeId); break;
        case 'alignVertical': alignNodes('vertical'); break;
        case 'alignHorizontal': alignNodes('horizontal'); break;
      }
    } else if (contextMenu.type === 'edge' && contextMenu.edgeId) {
      switch (action) {
        case 'deleteEdge': deleteEdge(contextMenu.edgeId); break;
        case 'arrowNone': updateEdgeArrow(contextMenu.edgeId, 'none'); break;
        case 'arrowStart': updateEdgeArrow(contextMenu.edgeId, 'start'); break;
        case 'arrowEnd': updateEdgeArrow(contextMenu.edgeId, 'end'); break;
        case 'arrowBoth': updateEdgeArrow(contextMenu.edgeId, 'both'); break;
      }
    } else if (contextMenu.type === 'image' && contextMenu.imageId) {
      if (action === 'deleteImage') deleteImage(contextMenu.imageId);
    } else if (contextMenu.type === 'canvas') {
      if (action === 'addNode' && contextMenu.canvasX !== undefined && contextMenu.canvasY !== undefined) addNodeAtPosition(contextMenu.canvasX, contextMenu.canvasY);
      else if (action === 'addImage') fileInputRef.current?.click();
    }
  }, [contextMenu, closeContextMenu, addChildNode, addSiblingNode, addParentNode, deleteNode, deleteEdge, updateEdgeArrow, addNodeAtPosition, alignNodes, deleteImage]);

  const handleNodeClick = useCallback((e: ReactMouseEvent, nodeId: string) => {
    e.stopPropagation(); if (showColorPalette) { setShowColorPalette(null); return; }
    const ctrlOrMeta = e.ctrlKey || e.metaKey;
    if (ctrlOrMeta) { setSelectedNodeIds(prev => prev.includes(nodeId) ? prev.filter(id => id !== nodeId) : [...prev, nodeId]); }
    else { setSelectedNodeId(nodeId); setSelectedNodeIds([nodeId]); }
    setSelectedEdgeId(null); setSelectedImageId(null); closeContextMenu();
  }, [closeContextMenu, showColorPalette]);

  const handleNodeDoubleClick = useCallback((e: ReactMouseEvent, nodeId: string) => { e.stopPropagation(); setEditingNodeId(nodeId); }, []);
  const handleCanvasClick = () => { if (wasDraggingRef.current || isCanvasPanning) { wasDraggingRef.current = false; return; } closeContextMenu(); };
  const handleTextEditComplete = (nodeId: string, newText: string) => { const trimmed = newText.trim(); if (trimmed) updateText(nodeId, trimmed); setEditingNodeId(null); };
  const handleEdgeClick = useCallback((e: ReactMouseEvent, edgeId: string) => { e.stopPropagation(); setSelectedNodeId(null); setSelectedNodeIds([]); setSelectedEdgeId(edgeId); setSelectedImageId(null); closeContextMenu(); }, [closeContextMenu]);
  const handleEdgeContextMenu = useCallback((e: ReactMouseEvent, edgeId: string) => { e.preventDefault(); e.stopPropagation(); setSelectedEdgeId(edgeId); setContextMenu({ visible: true, x: e.clientX, y: e.clientY, type: 'edge', edgeId }); }, []);
  const handleEdgeEndpointMouseDown = useCallback((e: ReactMouseEvent, edgeId: string, endpoint: 'source' | 'target') => { e.stopPropagation(); e.preventDefault(); setEditingEdgeEndpoint({ edgeId, endpoint }); }, []);

  const handleConnectionPointMouseDown = useCallback((e: ReactMouseEvent, nodeId: string, point: ConnectionPoint) => {
    e.stopPropagation(); e.preventDefault();
    const node = mindMap ? findNodeById(mindMap, nodeId) : null; if (!node) return;
    const pt = getConnectionPoint(node.x, node.y, point);
    setDrawingEdge({ sourceNodeId: nodeId, sourcePoint: point, currentX: pt.x, currentY: pt.y });
  }, [mindMap]);

  const showFloatingToolbar = selectedNodeIds.length === 1 && selectedNodeId && !draggingNodeId && !isCanvasPanning && !isSpacePressed && !drawingEdge && !selectionRect;
  const floatingToolbarPos = showFloatingToolbar && mindMap ? getNodeDisplayPos(selectedNodeId, mindMap, dragPositions, draggingNodeId) : null;

  if (!mindMap) return <div>Loading...</div>;
  const flatNodes = flattenTree(mindMap);

  const isAnyDragging = draggingNodeId !== null || isMultiDragging || isCanvasPanning;

  const edgeLines: { id: string; pathD: string; selected: boolean; arrow: string; sourceX: number; sourceY: number; targetX: number; targetY: number }[] = [];
  for (const edge of edges) {
    const sourcePos = getNodeDisplayPos(edge.sourceNodeId, mindMap, dragPositions, draggingNodeId);
    const targetPos = getNodeDisplayPos(edge.targetNodeId, mindMap, dragPositions, draggingNodeId);
    if (!sourcePos || !targetPos) continue;
    const startPt = getConnectionPoint(sourcePos.x, sourcePos.y, edge.sourcePoint);
    const endPt = getConnectionPoint(targetPos.x, targetPos.y, edge.targetPoint);
    const pathD = getEdgePath(startPt, endPt, edge.sourcePoint, edge.targetPoint, edgeStyle);
    edgeLines.push({ id: edge.id, pathD, selected: selectedEdgeId === edge.id, arrow: edge.arrow || 'none', sourceX: startPt.x, sourceY: startPt.y, targetX: endPt.x, targetY: endPt.y });
  }

  const participants = [
    { email: myEmail, color: myColor, isEditing: editingNodeId !== null, isSelecting: selectedNodeId !== null, isSelf: true },
    ...Object.entries(awarenessStates).map(([, state]) => ({ email: state.email, color: state.color, isEditing: state.editingNodeId !== null, isSelecting: state.selectedNodeId !== null, isSelf: false })),
  ];

  const statusColor = connectionStatus === '接続済み' ? 'bg-green-500' : (connectionStatus === '切断' || connectionStatus === 'タイムアウト' ? 'bg-red-500' : 'bg-yellow-500');
  const getImageUrl = (storagePath: string) => { const { data } = supabase.storage.from('images').getPublicUrl(storagePath); return data.publicUrl; };

  const canvasScrollClass = `w-full h-full overflow-auto pt-12 relative ${isSpacePressed ? (isCanvasPanning ? 'cursor-grabbing' : 'cursor-grab') : ''}`;
  const hideScrollbarStyle = { scrollbarWidth: 'none' as const, msOverflowStyle: 'none' as const, outline: 'none' };

  return (
    <div className="relative h-screen w-screen overflow-hidden" style={{ fontFamily: "'Inter', 'Noto Sans JP', sans-serif" }}>
      <style>{`.hide-scrollbar::-webkit-scrollbar { display: none; }`}</style>

      <input type="file" ref={fileInputRef} onChange={handleImageUpload} accept="image/*" className="hidden" />
      {!zenMode && (
        <div className="absolute top-0 left-0 right-0 z-50 flex items-center gap-1 bg-white border-b px-3 py-1.5 shadow-sm">
          <input value={mapTitle} onChange={e => setMapTitle(e.target.value)} className="border rounded px-2 py-1 text-sm w-40 font-medium" />
          <div className="flex items-center gap-0.5">
            <button onClick={handleUndo} disabled={!canUndo} className="p-1 rounded hover:bg-gray-100 disabled:opacity-30" title="元に戻す (Ctrl+Z)"><UndoIcon /></button>
            <button onClick={handleRedo} disabled={!canRedo} className="p-1 rounded hover:bg-gray-100 disabled:opacity-30" title="やり直し (Ctrl+Shift+Z)"><RedoIcon /></button>
          </div>
          <div className="w-px h-5 bg-gray-300 mx-1" />
          <div className="flex items-center gap-1">
            <button onClick={handleNewMap} className="flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 text-sm" title="新規マップ"><PlusIcon /><span>新規</span></button>
            <button onClick={handleSave} className="flex items-center gap-1 px-2 py-1 rounded hover:bg-blue-50 text-sm relative" title="保存 (Ctrl+S)"><SaveIcon /><span>保存</span>{isDirty && !saveMessage && <span className="absolute top-0 right-0 w-2 h-2 bg-yellow-400 rounded-full border border-white" />}{saveMessage === '保存完了' && <span className="text-green-600 text-xs ml-1">✓</span>}{saveMessage === '保存に失敗' && <span className="text-red-500 text-xs ml-1">✕</span>}</button>
            <button onClick={() => { fetchMaps(); setShowLoadMenu(!showLoadMenu); }} className="flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 text-sm" title="読み込む"><FolderIcon /><span>開く</span></button>
          </div>
          <div className="w-px h-5 bg-gray-300 mx-1" />
          <button onClick={handleShare} className="flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 text-sm" title="共有URLをコピー"><LinkIcon /><span>共有</span></button>
          {selectedNodeIds.length >= 2 && (
            <div className="flex items-center gap-1 ml-2">
              <button onClick={() => alignNodes('vertical')} className="p-1 rounded hover:bg-gray-100" title="垂直に整列"><AlignVIcon /></button>
              <button onClick={() => alignNodes('horizontal')} className="p-1 rounded hover:bg-gray-100" title="水平に整列"><AlignHIcon /></button>
            </div>
          )}

          <div className="w-px h-5 bg-gray-300 mx-1" />
          <div className="flex items-center gap-1 px-1">
            <select
              value={edgeStyle}
              onChange={e => setEdgeStyle(e.target.value as EdgeStyle)}
              className="text-xs border border-gray-200 bg-gray-50 hover:bg-gray-100 rounded px-2 py-1 outline-none text-gray-700 cursor-pointer shadow-sm"
              title="線のスタイル"
            >
              <option value="bezier">曲線</option>
              <option value="step">直角</option>
              <option value="straight">直線</option>
            </select>
          </div>

          <button onClick={scrollToHome} className="flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 text-sm ml-1" title="ホーム位置に戻る"><HomeIcon /></button>
          <div className="ml-auto mr-2 flex items-center gap-1"><button onClick={() => changeZoom(-0.1)} className="text-xs px-1 rounded hover:bg-gray-200">−</button><span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">{Math.round(zoomLevel * 100)}%</span><button onClick={() => changeZoom(0.1)} className="text-xs px-1 rounded hover:bg-gray-200">＋</button></div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1"><div className={`w-2 h-2 rounded-full ${statusColor}`} title={connectionStatus} /></div>
            <div className="relative">
              <button onClick={() => setShowParticipants(!showParticipants)} className="flex items-center gap-1 hover:bg-gray-100 rounded px-2 py-1 transition-colors" title="参加者一覧">
                <div className="flex -space-x-1.5">{participants.slice(0, 3).map((p, i) => (<div key={i} className={`w-5 h-5 rounded-full border border-white flex items-center justify-center text-[9px] font-bold text-white ${p.isSelf ? 'ring-1 ring-gray-300' : ''}`} style={{ backgroundColor: p.color }} title={p.email}>{getInitial(p.email)}</div>))}{participants.length > 3 && <div className="w-5 h-5 rounded-full border border-white bg-gray-300 flex items-center justify-center text-[9px] font-bold text-gray-600">+{participants.length - 3}</div>}</div>
                <span className="text-xs text-gray-500">{participants.length}人</span>
              </button>
              {showParticipants && (<div className="absolute top-full right-0 mt-1 w-56 bg-white border rounded-lg shadow-lg p-3 z-50"><h3 className="text-xs font-bold text-gray-600 mb-2">参加者 ({participants.length}人)</h3><div className="space-y-1.5 max-h-48 overflow-y-auto">{participants.map((p, i) => (<div key={i} className="flex items-center gap-2 text-xs"><div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0 ${p.isSelf ? 'ring-2 ring-blue-400' : ''}`} style={{ backgroundColor: p.color }}>{getInitial(p.email)}</div><div className="flex-1 min-w-0"><div className="text-gray-800 truncate">{p.email}{p.isSelf ? ' (あなた)' : ''}</div><div className="text-gray-400 text-[10px]">{p.isEditing ? '📝 編集中' : p.isSelecting ? '👆 選択中' : '👀 閲覧中'}</div></div></div>))}</div><button onClick={() => setShowParticipants(false)} className="mt-2 text-[10px] text-gray-500 underline w-full text-center">閉じる</button></div>)}
            </div>
            <div className="flex items-center gap-1.5" title={myEmail}>{user.user_metadata?.avatar_url ? <img src={user.user_metadata.avatar_url} alt="avatar" className="w-6 h-6 rounded-full border border-gray-300" onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextElementSibling?.classList.remove('hidden'); }} /> : null}<div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white ${user.user_metadata?.avatar_url ? 'hidden' : ''}`} style={{ backgroundColor: myColor }}>{getInitial(myEmail)}</div></div>
            <button onClick={handleLogout} className="bg-red-400 hover:bg-red-500 text-white text-xs px-2 py-1 rounded">ログアウト</button>
          </div>
        </div>
      )}
      {showLoadMenu && !zenMode && (<div className="absolute top-12 left-2 z-50 bg-white border rounded shadow-lg p-3 w-64 max-h-80 overflow-auto"><h3 className="font-bold text-sm mb-2">保存済みマップ</h3>{savedMaps.length === 0 && <p className="text-xs text-gray-500">まだ保存がありません</p>}{savedMaps.map(map => <div key={map.id} onClick={() => handleLoadMap(map)} className="cursor-pointer hover:bg-gray-100 p-1 rounded text-sm mb-1">{map.title}</div>)}<button onClick={() => setShowLoadMenu(false)} className="mt-2 text-xs text-gray-500 underline">閉じる</button></div>)}
      {zenMode && <button onClick={() => setZenMode(false)} className="absolute top-2 right-2 z-50 bg-white bg-opacity-90 border rounded-full px-3 py-1 text-xs shadow hover:bg-gray-100">ZEN解除 (Alt+Cmd+F)</button>}
      {contextMenu.visible && !showColorPalette && (
        <div className="fixed z-[100] bg-white border rounded-lg shadow-xl py-1 text-sm min-w-[160px]" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={e => e.stopPropagation()}>
          {contextMenu.type === 'node' && contextMenu.nodeId && (
            <>
              <button onClick={() => executeContextAction('addChild')} className="w-full text-left px-3 py-1.5 hover:bg-gray-100 flex items-center gap-2"><span className="text-xs">Tab</span> 子トピックを追加</button>
              <button onClick={() => executeContextAction('addSiblingAfter')} className="w-full text-left px-3 py-1.5 hover:bg-gray-100 flex items-center gap-2"><span className="text-xs">Enter</span> 下に追加</button>
              <button onClick={() => executeContextAction('addSiblingBefore')} className="w-full text-left px-3 py-1.5 hover:bg-gray-100 flex items-center gap-2"><span className="text-xs">Shift+Enter</span> 上に追加</button>
              <button onClick={() => executeContextAction('addParent')} className="w-full text-left px-3 py-1.5 hover:bg-gray-100 flex items-center gap-2"><span className="text-xs">⌘+Enter</span> 親トピックを追加</button>
              <hr className="my-1" />
              <button onClick={() => { setShowColorPalette({ nodeId: contextMenu.nodeId!, x: contextMenu.x, y: contextMenu.y }); setContextMenu(prev => ({ ...prev, visible: false })); }} className="w-full text-left px-3 py-1.5 hover:bg-gray-100">色を変更</button>
              <hr className="my-1" />
              {selectedNodeIds.length >= 2 && (
                <>
                  <button onClick={() => executeContextAction('alignVertical')} className="w-full text-left px-3 py-1.5 hover:bg-gray-100">垂直に整列</button>
                  <button onClick={() => executeContextAction('alignHorizontal')} className="w-full text-left px-3 py-1.5 hover:bg-gray-100">水平に整列</button>
                  <hr className="my-1" />
                </>
              )}
              <button onClick={() => executeContextAction('delete')} className="w-full text-left px-3 py-1.5 hover:bg-gray-100 text-red-600"><span className="text-xs">⌫</span> 削除</button>
            </>
          )}
          {contextMenu.type === 'edge' && (
            <>
              <button onClick={() => executeContextAction('deleteEdge')} className="w-full text-left px-3 py-1.5 hover:bg-gray-100 text-red-600"><span className="text-xs">⌫</span> この線を削除</button>
              <hr className="my-1" />
              <div className="px-3 py-1 text-xs text-gray-500">矢印の向き</div>
              <button onClick={() => executeContextAction('arrowNone')} className="w-full text-left px-3 py-1.5 hover:bg-gray-100">なし</button>
              <button onClick={() => executeContextAction('arrowStart')} className="w-full text-left px-3 py-1.5 hover:bg-gray-100">始点 →</button>
              <button onClick={() => executeContextAction('arrowEnd')} className="w-full text-left px-3 py-1.5 hover:bg-gray-100">終点 →</button>
              <button onClick={() => executeContextAction('arrowBoth')} className="w-full text-left px-3 py-1.5 hover:bg-gray-100">両方 ⇄</button>
            </>
          )}
          {contextMenu.type === 'image' && (
            <>
              <button onClick={() => executeContextAction('deleteImage')} className="w-full text-left px-3 py-1.5 hover:bg-gray-100 text-red-600">画像を削除</button>
            </>
          )}
          {contextMenu.type === 'canvas' && (
            <>
              <button onClick={() => executeContextAction('addNode')} className="w-full text-left px-3 py-1.5 hover:bg-gray-100">独立トピックを追加</button>
              <button onClick={() => executeContextAction('addImage')} className="w-full text-left px-3 py-1.5 hover:bg-gray-100">画像を添付</button>
            </>
          )}
        </div>
      )}
      {showColorPalette && (
        <div className="fixed z-[110] bg-white border rounded-lg shadow-xl p-2 text-sm" style={{ left: showColorPalette.x, top: showColorPalette.y }} onClick={e => e.stopPropagation()}>
          <div className="flex flex-wrap gap-1">{COLOR_PALETTE.map((cp, idx) => (<button key={idx} className="w-8 h-8 rounded-full border border-gray-300 hover:scale-110 transition-transform" style={{ backgroundColor: cp.bg, boxShadow: `0 0 0 2px ${cp.text}` }} title={cp.label} onClick={() => { updateNodeColors(showColorPalette.nodeId, cp.bg, cp.text); setShowColorPalette(null); closeContextMenu(); }} />))}</div>
          <button onClick={() => setShowColorPalette(null)} className="mt-2 text-xs text-gray-500 underline w-full text-center">閉じる</button>
        </div>
      )}

      <div
        ref={scrollContainerRef}
        className={`${canvasScrollClass} hide-scrollbar`}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onClick={handleCanvasClick}
        onContextMenu={handleCanvasContextMenu}
        onMouseDown={handleCanvasMouseDown}
        onDoubleClick={handleCanvasDoubleClick}
        style={hideScrollbarStyle}
      >
        <div
          className="relative"
          style={{
            width: '10000px',
            height: '10000px',
            transform: `scale(${zoomLevel})`,
            transformOrigin: '0 0',
            backgroundImage: 'radial-gradient(circle, #cbd5e1 1px, transparent 1px)',
            backgroundSize: '24px 24px',
            backgroundColor: '#f8fafc'
          }}
          onContextMenu={handleCanvasContextMenu}
        >
          {showFloatingToolbar && floatingToolbarPos && (
            <div
              className="absolute z-[60] bg-white rounded-lg shadow-xl border border-gray-200 flex items-center p-1 gap-1"
              style={{
                left: floatingToolbarPos.x,
                top: floatingToolbarPos.y - NODE_HEIGHT / 2 - 40,
                transform: 'translate(-50%, 0)',
                animation: 'fadeIn 0.15s ease-out'
              }}
              onClick={e => e.stopPropagation()}
              onMouseDown={e => e.stopPropagation()}
            >
              <style>{`@keyframes fadeIn { from { opacity: 0; transform: translate(-50%, 4px); } to { opacity: 1; transform: translate(-50%, 0); } }`}</style>
              <button onClick={() => setShowColorPalette({ nodeId: selectedNodeId, x: window.innerWidth / 2, y: window.innerHeight / 2 })} className="p-1.5 hover:bg-gray-100 rounded text-gray-600" title="色を変更"><PaletteIcon /></button>
              <div className="w-px h-4 bg-gray-300 mx-0.5" />
              <button onClick={() => addChildNode(selectedNodeId)} className="p-1.5 hover:bg-gray-100 rounded text-gray-600 flex items-center gap-1" title="子を追加 (Tab)"><SubNodeIcon /><span className="text-[10px] font-bold">子</span></button>
              <button onClick={() => addSiblingNode(selectedNodeId, 'after')} className="p-1.5 hover:bg-gray-100 rounded text-gray-600 flex items-center gap-1" title="兄弟を追加 (Enter)"><SiblingNodeIcon /><span className="text-[10px] font-bold">兄弟</span></button>
              <div className="w-px h-4 bg-gray-300 mx-0.5" />
              <button onClick={() => deleteNode(selectedNodeId)} className="p-1.5 hover:bg-red-50 rounded text-red-500" title="削除 (Delete/Backspace)"><TrashIcon /></button>
            </div>
          )}

          {images.map(image => (
            <div
              key={image.id}
              className={`absolute cursor-move border-2 ${selectedImageId === image.id ? 'border-blue-500' : 'border-transparent'}`}
              style={{ left: image.x, top: image.y, width: image.width, height: image.height, zIndex: 5 }}
              onMouseDown={(e) => handleMouseDownOnImage(e as any, image.id)}
              onContextMenu={(e) => handleImageContextMenu(e as any, image.id)}
              onClick={(e) => e.stopPropagation()}
            >
              <img src={getImageUrl(image.storagePath)} alt="" className="w-full h-full object-contain pointer-events-none" />
              {selectedImageId === image.id && (
                <>
                  <div className="absolute top-0 left-0 w-3 h-3 bg-white border border-blue-500 cursor-nw-resize" onMouseDown={(e) => handleResizeHandleMouseDown(e as any, image.id, 'nw')} />
                  <div className="absolute top-0 right-0 w-3 h-3 bg-white border border-blue-500 cursor-ne-resize" onMouseDown={(e) => handleResizeHandleMouseDown(e as any, image.id, 'ne')} />
                  <div className="absolute bottom-0 left-0 w-3 h-3 bg-white border border-blue-500 cursor-sw-resize" onMouseDown={(e) => handleResizeHandleMouseDown(e as any, image.id, 'sw')} />
                  <div className="absolute bottom-0 right-0 w-3 h-3 bg-white border border-blue-500 cursor-se-resize" onMouseDown={(e) => handleResizeHandleMouseDown(e as any, image.id, 'se')} />
                </>
              )}
            </div>
          ))}
          <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 1 }}>
            <defs><marker id="arrowStart" markerWidth="10" markerHeight="10" refX="2" refY="5" orient="auto-start-reverse"><polygon points="0,0 10,5 0,10" fill="#6b7280" /></marker><marker id="arrowEnd" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto"><polygon points="0,0 10,5 0,10" fill="#6b7280" /></marker></defs>

            {flatNodes.filter(fn => fn.parentId && fn.parentX !== undefined && fn.parentY !== undefined && !fn.independent).map(fn => {
              const parentPos = getNodeDisplayPos(fn.parentId as string, mindMap, dragPositions, draggingNodeId);
              const childPos = getNodeDisplayPos(fn.id, mindMap, dragPositions, draggingNodeId);
              if (!parentPos || !childPos) return null;
              const dx = childPos.x - parentPos.x, dy = childPos.y - parentPos.y;
              let parentPoint: ConnectionPoint, childPoint: ConnectionPoint;
              if (Math.abs(dx) > Math.abs(dy)) {
                parentPoint = dx > 0 ? 'right' : 'left'; childPoint = dx > 0 ? 'left' : 'right';
              } else {
                parentPoint = dy > 0 ? 'bottom' : 'top'; childPoint = dy > 0 ? 'top' : 'bottom';
              }
              const startPt = getConnectionPoint(parentPos.x, parentPos.y, parentPoint);
              const endPt = getConnectionPoint(childPos.x, childPos.y, childPoint);
              const pathD = getEdgePath(startPt, endPt, parentPoint, childPoint, edgeStyle);

              const edgeId = `parent-edge-${fn.id}`;
              const isSelected = selectedEdgeId === edgeId;

              return (
                <g key={edgeId} className="pointer-events-auto">
                  <path d={pathD} fill="none" stroke="transparent" strokeWidth={16} className="cursor-pointer" onClick={(e) => handleEdgeClick(e as any, edgeId)} onContextMenu={(e) => handleEdgeContextMenu(e as any, edgeId)} />
                  <path d={pathD} fill="none" stroke={isSelected ? '#f59e0b' : '#93c5fd'} strokeWidth={isSelected ? 4 : 3} className={`pointer-events-none ${isAnyDragging ? '' : 'transition-all duration-200 ease-out'}`} />
                </g>
              );
            })}

            {edgeLines.map(el => {
              const markerStart = el.arrow === 'start' || el.arrow === 'both' ? 'url(#arrowStart)' : 'none';
              const markerEnd = el.arrow === 'end' || el.arrow === 'both' ? 'url(#arrowEnd)' : 'none';
              return (
                <g key={el.id} className="pointer-events-auto">
                  <path d={el.pathD} fill="none" stroke="transparent" strokeWidth={16} className="cursor-pointer" onClick={(e) => handleEdgeClick(e as any, el.id)} onContextMenu={(e) => handleEdgeContextMenu(e as any, el.id)} />
                  <path d={el.pathD} fill="none" stroke={el.selected ? '#f59e0b' : '#93c5fd'} strokeWidth={el.selected ? 4 : 3} markerStart={markerStart} markerEnd={markerEnd} className={`${el.selected ? '' : 'pointer-events-none'} ${isAnyDragging ? '' : 'transition-all duration-200 ease-out'}`} onClick={el.selected ? undefined : (e) => handleEdgeClick(e as any, el.id)} onContextMenu={(e) => handleEdgeContextMenu(e as any, el.id)} />
                  {el.selected && (<>
                    <circle cx={el.sourceX} cy={el.sourceY} r={6} fill="#3b82f6" stroke="white" strokeWidth={2} className="cursor-grab pointer-events-auto hover:scale-125 transition-transform" onMouseDown={(e) => handleEdgeEndpointMouseDown(e as any, el.id, 'source')} />
                    <circle cx={el.targetX} cy={el.targetY} r={6} fill="#ef4444" stroke="white" strokeWidth={2} className="cursor-grab pointer-events-auto hover:scale-125 transition-transform" onMouseDown={(e) => handleEdgeEndpointMouseDown(e as any, el.id, 'target')} />
                  </>)}
                </g>
              );
            })}

            {drawingEdge && mindMap && (
              <path
                d={getEdgePath(
                  getConnectionPoint((findNodeById(mindMap, drawingEdge.sourceNodeId)?.x ?? 0), (findNodeById(mindMap, drawingEdge.sourceNodeId)?.y ?? 0), drawingEdge.sourcePoint),
                  {x: drawingEdge.currentX, y: drawingEdge.currentY},
                  drawingEdge.sourcePoint,
                  drawingEdge.targetPoint || 'left',
                  edgeStyle
                )}
                fill="none" stroke="#f59e0b" strokeWidth={4} strokeDasharray="5,5" className="pointer-events-none"
              />
            )}

            {selectionRect && (
              <rect
                x={Math.min(selectionRect.x1, selectionRect.x2)}
                y={Math.min(selectionRect.y1, selectionRect.y2)}
                width={Math.abs(selectionRect.x2 - selectionRect.x1)}
                height={Math.abs(selectionRect.y2 - selectionRect.y1)}
                fill="rgba(59, 130, 246, 0.15)"
                stroke="#3b82f6"
                strokeWidth={1}
                strokeDasharray="4 4"
              />
            )}
          </svg>
          <RecursiveNode node={mindMap} selectedNodeId={selectedNodeId} selectedNodeIds={selectedNodeIds} editingNodeId={editingNodeId} draggingNodeId={draggingNodeId} dragPositions={dragPositions} dragTargetNodeId={dragTargetNodeId} isMultiDragging={isMultiDragging} awarenessStates={awarenessStates} myUserId={myUserId} onNodeClick={handleNodeClick} onNodeDoubleClick={handleNodeDoubleClick} onMouseDownOnNode={handleMouseDownOnNode} onTextEditComplete={handleTextEditComplete} onContextMenu={handleNodeContextMenu} onConnectionPointMouseDown={handleConnectionPointMouseDown} depth={0} isAnyDragging={isAnyDragging} />
        </div>
      </div>
    </div>
  );
};

// --------------------- 再帰ノード ---------------------
interface RecursiveNodeProps {
  node: MindNode;
  selectedNodeId: string | null;
  selectedNodeIds: string[];
  editingNodeId: string | null;
  draggingNodeId: string | null;
  dragPositions: Record<string, { x: number; y: number }>;
  dragTargetNodeId: string | null;
  isMultiDragging: boolean;
  awarenessStates: Record<string, AwarenessState>;
  myUserId: string;
  onNodeClick: (e: ReactMouseEvent, nodeId: string) => void;
  onNodeDoubleClick: (e: ReactMouseEvent, nodeId: string) => void;
  onMouseDownOnNode: (e: ReactMouseEvent, nodeId: string) => void;
  onTextEditComplete: (nodeId: string, text: string) => void;
  onContextMenu: (e: ReactMouseEvent, nodeId: string) => void;
  onConnectionPointMouseDown: (e: ReactMouseEvent, nodeId: string, point: ConnectionPoint) => void;
  depth: number;
  isAnyDragging: boolean;
}

const RecursiveNode = ({ node, selectedNodeId, selectedNodeIds, editingNodeId, draggingNodeId, dragPositions, dragTargetNodeId, isMultiDragging, awarenessStates, myUserId, onNodeClick, onNodeDoubleClick, onMouseDownOnNode, onTextEditComplete, onContextMenu, onConnectionPointMouseDown, depth, isAnyDragging }: RecursiveNodeProps) => {
  const isSelected = selectedNodeIds.includes(node.id);
  const isSingleSelected = selectedNodeId === node.id;
  const isEditing = editingNodeId === node.id, isSingleDragging = draggingNodeId === node.id;
  const isTarget = dragTargetNodeId === node.id;
  const inputRef = useRef<HTMLInputElement>(null);

  const displayPos = (() => {
    if (isMultiDragging && dragPositions[node.id]) return dragPositions[node.id];
    if (isSingleDragging && dragPositions[node.id]) return dragPositions[node.id];
    return { x: node.x, y: node.y };
  })();

  useEffect(() => { if (isEditing && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); } }, [isEditing]);
  const handleBlur = () => { if (inputRef.current) onTextEditComplete(node.id, inputRef.current.value); };
  const handleInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') { e.preventDefault(); if (inputRef.current) onTextEditComplete(node.id, inputRef.current.value); } else if (e.key === 'Escape') onTextEditComplete(node.id, node.text); };
  const remoteEditors = Object.entries(awarenessStates).filter(([, state]) => state.editingNodeId === node.id).map(([, state]) => state);
  const remoteSelectors = Object.entries(awarenessStates).filter(([, state]) => state.selectedNodeId === node.id && state.editingNodeId !== node.id).map(([, state]) => state);

  const depthTextClass = depth === 0 ? 'text-base font-bold' : (depth === 1 ? 'text-sm font-semibold' : 'text-xs font-medium');
  const depthShadowClass = depth === 0 ? 'shadow-lg' : (depth === 1 ? 'shadow-md' : 'shadow-sm hover:shadow-md');
  const activeShadowClass = isSelected ? 'shadow-lg shadow-blue-500/20' : depthShadowClass;

  const borderColorClass = isTarget ? 'border-green-400 border-3' : (isSelected ? (isSingleSelected ? 'border-blue-500 ring-2 ring-blue-200' : 'border-purple-500') : '');
  const connectionPoints: ConnectionPoint[] = ['top', 'right', 'bottom', 'left'];

  return (
    <>
      <div
        className={`absolute flex items-center justify-center rounded-xl border-2 px-4 py-2 cursor-pointer select-none ${isAnyDragging ? '' : 'transition-all duration-200 ease-out'} ${activeShadowClass} ${borderColorClass} ${isEditing ? 'bg-yellow-100 ring-4 ring-yellow-400/30' : ''}`}
        style={{
          left: displayPos.x - NODE_WIDTH/2, top: displayPos.y - NODE_HEIGHT/2,
          width: NODE_WIDTH, height: NODE_HEIGHT, zIndex: 10 + depth,
          backgroundColor: node.bgColor || '#ffffff',
          borderColor: isSelected ? undefined : (node.textColor || '#0369a1'),
          color: node.textColor || '#0369a1',
        }}
        onClick={e => onNodeClick(e, node.id)} onDoubleClick={e => onNodeDoubleClick(e, node.id)} onMouseDown={e => onMouseDownOnNode(e, node.id)} onContextMenu={e => onContextMenu(e, node.id)}
      >
        {isEditing ? (
          <input ref={inputRef} className={`w-full h-full bg-transparent text-center outline-none border-none ${depthTextClass}`} defaultValue={node.text} onBlur={handleBlur} onKeyDown={handleInputKeyDown} onClick={e => e.stopPropagation()} />
        ) : (
          <span className={`${depthTextClass} truncate block max-w-full`} style={{ color: node.textColor || '#0f172a' }}>{node.text}</span>
        )}
        {remoteEditors.length > 0 && <div className="absolute -top-2 -right-2 flex -space-x-1">{remoteEditors.map((editor, i) => <div key={i} className="w-3 h-3 rounded-full border border-white" style={{ backgroundColor: editor.color }} title={`${editor.email} が編集中`} />)}</div>}
        {remoteSelectors.length > 0 && remoteEditors.length === 0 && <div className="absolute -top-2 -right-2 flex -space-x-1">{remoteSelectors.map((selector, i) => <div key={i} className="w-2 h-2 rounded-full border border-white opacity-60" style={{ backgroundColor: selector.color }} title={`${selector.email} が選択中`} />)}</div>}
      </div>
      {isSingleSelected && !isMultiDragging && connectionPoints.map(point => { const pt = getConnectionPoint(displayPos.x, displayPos.y, point); return <div key={point} className={`absolute w-3 h-3 bg-blue-500 border-2 border-white rounded-full cursor-crosshair hover:scale-150 shadow-sm ${isAnyDragging ? '' : 'transition-all duration-200 ease-out'}`} style={{ left: pt.x-6, top: pt.y-6, zIndex: 20 + depth }} onMouseDown={e => onConnectionPointMouseDown(e, node.id, point)} />; })}
      {node.children.map(child => (<RecursiveNode key={child.id} node={child} selectedNodeId={selectedNodeId} selectedNodeIds={selectedNodeIds} editingNodeId={editingNodeId} draggingNodeId={draggingNodeId} dragPositions={dragPositions} dragTargetNodeId={dragTargetNodeId} isMultiDragging={isMultiDragging} awarenessStates={awarenessStates} myUserId={myUserId} onNodeClick={onNodeClick} onNodeDoubleClick={onNodeDoubleClick} onMouseDownOnNode={onMouseDownOnNode} onTextEditComplete={onTextEditComplete} onContextMenu={onContextMenu} onConnectionPointMouseDown={onConnectionPointMouseDown} depth={depth+1} isAnyDragging={isAnyDragging} />))}
    </>
  );
};

export default App;