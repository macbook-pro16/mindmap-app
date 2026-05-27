"use client";

import { useState, useCallback, useRef, useEffect } from 'react';
import type { KeyboardEvent, MouseEvent as ReactMouseEvent, ChangeEvent } from 'react';
import * as Y from 'yjs';
import { supabase } from './supabaseClient';
import type { RealtimeChannel, User } from '@supabase/supabase-js';

// Vercelデプロイ時の TS2591 (Cannot find name 'process') 回避用
declare var process: any;

// --------------------- 型定義 ---------------------
export interface YjsNodeData {
  text: string;
  x: number;
  y: number;
  children: string[];
  independent?: boolean;
  bgColor?: string;
  textColor?: string;
}

export interface YjsEdgeData {
  sourceNodeId: string;
  sourcePoint: ConnectionPoint;
  targetNodeId: string;
  targetPoint: ConnectionPoint;
  arrow: 'none' | 'start' | 'end' | 'both';
}

export interface YjsImageData {
  storagePath: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface YjsStickyData {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  bgColor: string;
  textColor: string;
}

export interface MindNode {
  id: string;
  text: string;
  children: MindNode[];
  x: number;
  y: number;
  independent?: boolean;
  bgColor?: string;
  textColor?: string;
}

export interface FlatNode {
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

export interface MapMember {
  user_id: string;
  email: string;
}

export interface MapRecord {
  id: number;
  title: string;
  data: MindNode;
  room_id: string;
  created_at: string;
  updated_at?: string;
  members?: MapMember[];
}

export interface AwarenessState {
  email: string;
  color: string;
  selectedNodeId: string | null;
  editingNodeId: string | null;
}

// 参加者リスト用の統合インターフェース
export interface Participant {
  user_id: string;
  email: string;
  color: string;
  isOnline: boolean;
  isSelf: boolean;
  selectedNodeId: string | null;
  editingNodeId: string | null;
}

export interface ContextMenuInfo {
  visible: boolean;
  x: number;
  y: number;
  type: 'node' | 'canvas' | 'edge' | 'colorPalette' | 'image' | 'sticky';
  nodeId?: string;
  edgeId?: string;
  imageId?: string;
  stickyId?: string;
  canvasX?: number;
  canvasY?: number;
}

export type ConnectionPoint = 'top' | 'right' | 'bottom' | 'left';
export type EdgeStyle = 'bezier' | 'step' | 'straight';

export interface EdgeData {
  id: string;
  sourceNodeId: string;
  sourcePoint: ConnectionPoint;
  targetNodeId: string;
  targetPoint: ConnectionPoint;
  arrow: 'none' | 'start' | 'end' | 'both';
}

export interface ImageData {
  id: string;
  storagePath: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface StickyData {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  bgColor: string;
  textColor: string;
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

const DEFAULT_STICKY_WIDTH = 200;
const DEFAULT_STICKY_HEIGHT = 160;
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

const getStepPath = (p1: { x: number; y: number }, p2: { x: number; y: number }, p1Dir: ConnectionPoint): string => {
  if (p1Dir === 'right' || p1Dir === 'left') {
    const midX = (p1.x + p2.x) / 2;
    return `M ${p1.x} ${p1.y} L ${midX} ${p1.y} L ${midX} ${p2.y} L ${p2.x} ${p2.y}`;
  } else {
    const midY = (p1.y + p2.y) / 2;
    return `M ${p1.x} ${p1.y} L ${p1.x} ${midY} L ${p2.x} ${midY} L ${p2.x} ${p2.y}`;
  }
};

const getStraightPath = (p1: { x: number; y: number }, p2: { x: number; y: number }): string => {
  return `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`;
};

const getEdgePath = (p1: { x: number; y: number }, p2: { x: number; y: number }, p1Dir: ConnectionPoint, p2Dir: ConnectionPoint, style: EdgeStyle): string => {
  switch (style) {
    case 'straight': return getStraightPath(p1, p2);
    case 'step': return getStepPath(p1, p2, p1Dir);
    case 'bezier':
    default: return getBezierPath(p1, p2, p1Dir, p2Dir);
  }
};

const getUnoccupiedPosition = (startX: number, startY: number, yNodes: Y.Map<YjsNodeData>): { x: number; y: number } => {
  let x = startX;
  let y = startY;
  let isOccupied = true;
  while (isOccupied) {
    let collision = false;
    yNodes.forEach((node: YjsNodeData) => {
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
  const children = node.children.flatMap((c: MindNode) => flattenTree(c, node.id, node.x, node.y));
  return [current, ...children];
};

const getAllNodes = (root: MindNode): MindNode[] => {
  let result: MindNode[] = [root];
  for (const child of root.children) {
    result = result.concat(getAllNodes(child));
  }
  return result;
};

// --------------------- アイコン ---------------------
const UndoIcon = () => ( <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a5 5 0 015 5v2M3 10l4-4M3 10l4 4" /></svg> );
const RedoIcon = () => ( <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 10H11a5 5 0 00-5 5v2m15-7l-4-4m4 4l-4 4" /></svg> );
const PlusIcon = () => ( <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg> );
const SaveIcon = () => ( <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v11a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-4 0V4m0 3h4m-4 0H8" /></svg> );
const LinkIcon = () => ( <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 010 5.656l-2.828 2.828a4 4 0 01-5.656-5.656l2.828-2.828m6.364-6.364a4 4 0 010 5.656l-2.828 2.828a4 4 0 01-5.656-5.656l2.828-2.828" /></svg> );
const HomeIcon = () => ( <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg> );
const AlignVIcon = () => ( <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><line x1="12" y1="3" x2="12" y2="21" strokeWidth={2} /><path strokeWidth={2} d="M5 7l7-4 7 4M5 17l7 4 7-4" /></svg> );
const AlignHIcon = () => ( <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><line x1="3" y1="12" x2="21" y2="12" strokeWidth={2} /><path strokeWidth={2} d="M7 5l-4 7 4 7M17 5l4 7-4 7" /></svg> );
const PaletteIcon = () => ( <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" /></svg> );
const TrashIcon = () => ( <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg> );
const SubNodeIcon = () => ( <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg> );
const SiblingNodeIcon = ({ className = '' }: { className?: string }) => ( <svg className={`w-4 h-4 ${className}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" /></svg> );
const MenuIcon = () => ( <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg> );
const CopyIcon = () => ( <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg> );
const ParentNodeIcon = () => ( <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg> );
const StickyIcon = () => ( <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg> );
const ImageIcon = () => ( <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg> );

// --------------------- データ変換ユーティリティ ---------------------
const yMapToTree = (nodes: Y.Map<YjsNodeData>, rootId: string): MindNode | null => {
  const convert = (id: string): MindNode | null => {
    const data = nodes.get(id);
    if (!data) return null;
    const childIds = (data.children || []) as string[];
    const children = childIds.map(convert).filter((c): c is MindNode => c !== null);
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

const treeToYMap = (root: MindNode, nodes: Y.Map<YjsNodeData>) => {
  nodes.set(root.id, {
    text: root.text, x: root.x, y: root.y,
    independent: root.independent ?? false,
    bgColor: root.bgColor ?? '#f0f9ff',
    textColor: root.textColor ?? '#0369a1',
    children: root.children.map((c: MindNode) => c.id),
  });
  root.children.forEach((c: MindNode) => treeToYMap(c, nodes));
};

const uint8ArrayToBase64 = (u8: Uint8Array): string => { let binary = ''; for (let i = 0; i < u8.byteLength; i++) binary += String.fromCharCode(u8[i]); return btoa(binary); };
const base64ToUint8Array = (b64: string): Uint8Array => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
const stringToColor = (str: string): string => { let hash = 0; for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash); return `hsl(${Math.abs(hash) % 360}, 70%, 60%)`; };
const getInitial = (email: string): string => email.split('@')[0].substring(0, 2).toUpperCase();
const findParentId = (nodes: Y.Map<YjsNodeData>, childId: string): string | null => {
  let result: string | null = null;
  nodes.forEach((value: YjsNodeData, key: string) => { if (value.children?.includes(childId)) result = key; });
  return result;
};
const findNodeAtPoint = (root: MindNode, x: number, y: number, excludeId?: string): MindNode | null => {
  if (excludeId && root.id === excludeId) return null;
  const stack: MindNode[] = [root];
  while (stack.length) {
    const node = stack.pop()!;
    const left = node.x - NODE_WIDTH / 2 - 15, top = node.y - NODE_HEIGHT / 2 - 15;
    if (x >= left && x <= left + NODE_WIDTH + 30 && y >= top && y <= top + NODE_HEIGHT + 30 && node.id !== excludeId) return node;
    for (const c of node.children) stack.push(c);
  }
  return null;
};
const findNodeById = (root: MindNode, id: string): MindNode | null => { if (root.id === id) return root; for (const c of root.children) { const found = findNodeById(c, id); if (found) return found; } return null; };
const getNodeDisplayPos = (nodeId: string, mindMap: MindNode | null, dragPositions: Record<string, { x: number; y: number }>, draggingNodeId: string | null): { x: number; y: number } | null => {
  if (!mindMap) return null;
  const node = findNodeById(mindMap, nodeId);
  if (!node) return null;
  if (nodeId === draggingNodeId && dragPositions[nodeId]) return dragPositions[nodeId];
  return { x: node.x, y: node.y };
};
const getCanvasCoords = (clientX: number, clientY: number, container: HTMLDivElement, zoomLevel: number): { x: number; y: number } => {
  const rect = container.getBoundingClientRect();
  return { x: (clientX - rect.left + container.scrollLeft) / zoomLevel, y: (clientY - rect.top + container.scrollTop) / zoomLevel };
};
const isNodeInRect = (node: MindNode, rect: { x1: number; y1: number; x2: number; y2: number }): boolean => {
  const left = node.x - NODE_WIDTH / 2, right = node.x + NODE_WIDTH / 2, top = node.y - NODE_HEIGHT / 2, bottom = node.y + NODE_HEIGHT / 2;
  const rx1 = Math.min(rect.x1, rect.x2);
  const rx2 = Math.max(rect.x1, rect.x2);
  const ry1 = Math.min(rect.y1, rect.y2);
  const ry2 = Math.max(rect.y1, rect.y2);
  return !(right < rx1 || left > rx2 || bottom < ry1 || top > ry2);
};

// --------------------- 認証画面 ---------------------
const AuthScreen = () => (
  <div className="flex items-center justify-center h-screen bg-slate-50">
    <div className="bg-white p-8 rounded-2xl shadow-xl border border-slate-100 text-center max-w-sm w-full">
      <h2 className="text-2xl font-bold mb-2 text-slate-800">MindMap Login</h2>
      <p className="text-sm text-slate-500 mb-6">チームで直感的にアイデアを共有</p>
      <button 
        onClick={() => {
            if(typeof window !== 'undefined') {
                supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
            }
        }} 
        className="w-full bg-white border border-slate-300 rounded-lg py-3 px-4 flex items-center justify-center gap-3 hover:bg-slate-50 transition-colors shadow-sm font-medium text-slate-700"
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
        Googleでログイン
      </button>
    </div>
  </div>
);

// --------------------- メイン ---------------------
const App = () => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => { setUser(session?.user ?? null); setLoading(false); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => listener.subscription.unsubscribe();
  }, []);
  if (loading) return <div className="flex items-center justify-center h-screen bg-slate-50 text-slate-500">Loading...</div>;
  if (!user) return <AuthScreen />;
  return <MindMapApp user={user} />;
};

// --------------------- 共同編集マインドマップ ---------------------
const MindMapApp = ({ user }: { user: User }) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mapId, setMapId] = useState<number | null>(null);
  const [mapTitle, setMapTitle] = useState('無題のマップ');
  const [roomId, setRoomId] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState('');
  const [savedMaps, setSavedMaps] = useState<MapRecord[]>([]);
  const [mapMembers, setMapMembers] = useState<MapMember[]>([]);

  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [edgeStyle, setEdgeStyle] = useState<EdgeStyle>('bezier');

  const ydocRef = useRef<Y.Doc | null>(null);
  const yNodesRef = useRef<Y.Map<YjsNodeData> | null>(null);
  const yEdgesRef = useRef<Y.Map<YjsEdgeData> | null>(null);
  const yImagesRef = useRef<Y.Map<YjsImageData> | null>(null);
  const yStickiesRef = useRef<Y.Map<YjsStickyData> | null>(null);
  const ySettingsRef = useRef<Y.Map<string> | null>(null);
  const yRootRef = useRef<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const undoManagerRef = useRef<Y.UndoManager | null>(null);

  const [mindMap, setMindMap] = useState<MindNode | null>(null);
  const [edges, setEdges] = useState<EdgeData[]>([]);
  const [images, setImages] = useState<ImageData[]>([]);
  const [stickies, setStickies] = useState<StickyData[]>([]);
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

  const [showColorPalette, setShowColorPalette] = useState<{ nodeId?: string; stickyId?: string; x: number; y: number } | null>(null);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [selectedStickyId, setSelectedStickyId] = useState<string | null>(null);
  const [draggingImageId, setDraggingImageId] = useState<string | null>(null);
  const [draggingStickyId, setDraggingStickyId] = useState<string | null>(null);
  const [resizingImageHandle, setResizingImageHandle] = useState<{ imageId: string; handle: string } | null>(null);
  const [resizingStickyHandle, setResizingStickyHandle] = useState<{ stickyId: string; handle: string } | null>(null);
  const [editingStickyId, setEditingStickyId] = useState<string | null>(null);
  const imageDragOffset = useRef({ x: 0, y: 0 });
  const stickyDragOffset = useRef({ x: 0, y: 0 });

  const [selectionRect, setSelectionRect] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const wasDraggingRef = useRef(false);
  const groupDragStartMouse = useRef({ x: 0, y: 0 });
  const initialGroupDragPositions = useRef<Record<string, { x: number; y: number }>>({});
  const isMultiDragging = selectedNodeIds.length > 1 && Object.keys(dragPositions).length > 0;

  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [isCanvasPanning, setIsCanvasPanning] = useState(false);
  const panStartCoords = useRef({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });

  const addLog = (msg: string) => { if (process.env.NODE_ENV !== 'production') console.log(`[MindMap] ${msg}`); };
  const [connectionStatus, setConnectionStatus] = useState('接続中...');
  const [awarenessStates, setAwarenessStates] = useState<Record<string, AwarenessState>>({});
  const [showParticipants, setShowParticipants] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const myUserId = user.id;
  const myEmail = user.email || '';
  const myColor = stringToColor(myEmail);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1.0);
  const [zenMode, setZenMode] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuInfo>({ visible: false, x: 0, y: 0, type: 'canvas' });

  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteMessage, setInviteMessage] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);

  const closeContextMenu = useCallback(() => { setContextMenu(prev => ({ ...prev, visible: false })); setShowColorPalette(null); }, []);
  const scrollToHome = useCallback(() => { const container = scrollContainerRef.current; if (!container) return; const centerX = 5000 * zoomLevel - container.clientWidth / 2; const centerY = 5000 * zoomLevel - container.clientHeight / 2; container.scrollTo({ left: centerX, top: centerY, behavior: 'smooth' }); }, [zoomLevel]);
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
    const handleGlobalKeyDown = (e: globalThis.KeyboardEvent) => { if (e.code === 'Space' && !editingNodeId && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') { e.preventDefault(); setIsSpacePressed(true); } };
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
            if (parentNode) nodes.set(parentId, { ...parentNode, children: (parentNode.children as string[]).filter((id: string) => id !== childId) });
            nodes.set(childId, { ...childNode, independent: true });
            nodes.set(rootId, { ...rootNode, children: [...(rootNode.children as string[]), childId] });
          } else { nodes.set(childId, { ...childNode, independent: true }); }
        }
      });
      setSelectedEdgeId(null); closeContextMenu(); return;
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
      nodes.set(oldParentId, { ...oldParent, children: (oldParent.children as string[]).filter((id: string) => id !== nodeId) });
      const nodeData = nodes.get(nodeId); nodes.set(nodeId, { ...nodeData!, independent: false });
      nodes.set(newParentId, { ...newParent, children: [...(newParent.children as string[]), nodeId] });
    });
  }, []);

  const addChildNode = useCallback((parentId: string) => {
    const nodes = yNodesRef.current; if (!nodes) return; const parent = nodes.get(parentId); if (!parent) return;
    const childId = crypto.randomUUID(); const safePos = getUnoccupiedPosition(parent.x + NODE_WIDTH + 40, parent.y, nodes);
    ydocRef.current?.transact(() => { nodes.set(childId, { text: '新しいトピック', x: safePos.x, y: safePos.y, children: [], independent: false, bgColor: '#f0f9ff', textColor: '#0369a1' }); nodes.set(parentId, { ...parent, children: [...(parent.children ?? []), childId] }); });
    setSelectedNodeId(childId); setSelectedNodeIds([childId]);
  }, []);

  const addSiblingNode = useCallback((targetId: string, position: 'before' | 'after') => {
    const nodes = yNodesRef.current; if (!nodes || !yRootRef.current) return; if (targetId === yRootRef.current) return;
    const parentId = findParentId(nodes, targetId); if (!parentId) return; const parent = nodes.get(parentId); if (!parent) return;
    const siblingId = crypto.randomUUID(); const targetNode = nodes.get(targetId);
    const safePos = getUnoccupiedPosition(targetNode ? targetNode.x : parent.x + NODE_WIDTH + 40, targetNode ? targetNode.y + (position === 'after' ? (NODE_HEIGHT + 20) : -(NODE_HEIGHT + 20)) : parent.y, nodes);
    const curChildren: string[] = parent.children ?? []; const targetIndex = curChildren.indexOf(targetId); const newChildren = [...curChildren]; newChildren.splice(position === 'before' ? targetIndex : targetIndex + 1, 0, siblingId);
    ydocRef.current?.transact(() => { nodes.set(siblingId, { text: '新しいトピック', x: safePos.x, y: safePos.y, children: [], independent: false, bgColor: '#f0f9ff', textColor: '#0369a1' }); nodes.set(parentId, { ...parent, children: newChildren }); });
    setSelectedNodeId(siblingId); setSelectedNodeIds([siblingId]);
  }, []);

  const addParentNode = useCallback((targetId: string) => {
    const nodes = yNodesRef.current; if (!nodes || !yRootRef.current) return; if (targetId === yRootRef.current) return;
    const oldParentId = findParentId(nodes, targetId); if (!oldParentId) return; const oldParent = nodes.get(oldParentId); if (!oldParent) return;
    const targetNode = nodes.get(targetId); if (!targetNode) return;
    const newParentId = crypto.randomUUID(); const safePos = getUnoccupiedPosition(targetNode.x - NODE_WIDTH - 40, targetNode.y, nodes);
    ydocRef.current?.transact(() => { nodes.set(newParentId, { text: '新しいトピック', x: safePos.x, y: safePos.y, children: [targetId], independent: false, bgColor: '#f0f9ff', textColor: '#0369a1' }); const updatedOldChildren = (oldParent.children ?? []).filter((id: string) => id !== targetId); updatedOldChildren.push(newParentId); nodes.set(oldParentId, { ...oldParent, children: updatedOldChildren }); });
    setSelectedNodeId(newParentId); setSelectedNodeIds([newParentId]);
  }, []);

  const addNodeAtPosition = useCallback((x: number, y: number) => {
    const nodes = yNodesRef.current, rootId = yRootRef.current; if (!nodes || !rootId) return;
    const childId = crypto.randomUUID(); const safePos = getUnoccupiedPosition(x, y, nodes);
    ydocRef.current?.transact(() => { nodes.set(childId, { text: '独立トピック', x: safePos.x, y: safePos.y, children: [], independent: true, bgColor: '#f0f9ff', textColor: '#0369a1' }); const root = nodes.get(rootId); if (root) nodes.set(rootId, { ...root, children: [...(root.children ?? []), childId] }); });
    setSelectedNodeId(childId); setSelectedNodeIds([childId]);
  }, []);

  const addIndependentSibling = useCallback((targetId: string, position: 'before' | 'after') => {
    const nodes = yNodesRef.current; if (!nodes || !yRootRef.current) return;
    const targetNode = nodes.get(targetId); if (!targetNode) return;
    const newId = crypto.randomUUID();
    const offsetY = position === 'after' ? (NODE_HEIGHT + 20) : -(NODE_HEIGHT + 20);
    const safePos = getUnoccupiedPosition(targetNode.x, targetNode.y + offsetY, nodes);
    const rootId = yRootRef.current;
    ydocRef.current?.transact(() => {
      nodes.set(newId, { text: '独立トピック', x: safePos.x, y: safePos.y, children: [], independent: true, bgColor: '#f0f9ff', textColor: '#0369a1' });
      const root = nodes.get(rootId); if (root) {
        const curChildren: string[] = root.children ?? [];
        const targetIndex = curChildren.indexOf(targetId);
        const newChildren = [...curChildren];
        newChildren.splice(position === 'before' ? targetIndex : targetIndex + 1, 0, newId);
        nodes.set(rootId, { ...root, children: newChildren });
      }
    });
    setSelectedNodeId(newId); setSelectedNodeIds([newId]);
  }, []);

  const addSticky = useCallback((x: number, y: number) => {
    const yStickies = yStickiesRef.current; if (!yStickies || !ydocRef.current) return;
    const id = crypto.randomUUID();
    ydocRef.current.transact(() => {
      yStickies.set(id, {
        x, y, width: DEFAULT_STICKY_WIDTH, height: DEFAULT_STICKY_HEIGHT,
        text: '', bgColor: '#fefce8', textColor: '#854d0e'
      });
    });
    setSelectedStickyId(id); setSelectedNodeId(null); setSelectedEdgeId(null); setSelectedImageId(null);
  }, []);

  const deleteNode = useCallback((nodeId: string) => { const nodes = yNodesRef.current; if (!nodes || !yRootRef.current || nodeId === yRootRef.current) return; ydocRef.current?.transact(() => { nodes.forEach((value: YjsNodeData, key: string) => { if (value.children?.includes(nodeId)) nodes.set(key, { ...value, children: value.children.filter((id: string) => id !== nodeId) }); }); nodes.delete(nodeId); }); setSelectedNodeId(null); setSelectedNodeIds([]); }, []);

  const deleteMultipleNodes = useCallback((nodeIds: string[]) => {
    const nodes = yNodesRef.current; if (!nodes || !yRootRef.current) return;
    ydocRef.current?.transact(() => {
      nodeIds.forEach((nodeId: string) => {
        if (nodeId === yRootRef.current) return;
        nodes.forEach((value: YjsNodeData, key: string) => { if (value.children?.includes(nodeId)) nodes.set(key, { ...value, children: value.children.filter((id: string) => id !== nodeId) }); });
        nodes.delete(nodeId);
      });
    });
    setSelectedNodeId(null); setSelectedNodeIds([]);
  }, []);

  const updateText = useCallback((nodeId: string, text: string) => { const nodes = yNodesRef.current; if (!nodes) return; const data = nodes.get(nodeId); if (data) nodes.set(nodeId, { ...data, text }); }, []);
  const updatePosition = useCallback((nodeId: string, x: number, y: number) => { const nodes = yNodesRef.current; if (!nodes) return; const data = nodes.get(nodeId); if (data) nodes.set(nodeId, { ...data, x, y }); }, []);
  const updateNodeColors = useCallback((nodeId: string, bgColor: string, textColor: string) => { const nodes = yNodesRef.current; if (!nodes) return; const data = nodes.get(nodeId); if (data) nodes.set(nodeId, { ...data, bgColor, textColor }); }, []);

  const updateMultipleNodeColors = useCallback((nodeIds: string[], bgColor: string, textColor: string) => {
    const nodes = yNodesRef.current; if (!nodes) return;
    ydocRef.current?.transact(() => {
      nodeIds.forEach((id: string) => { const data = nodes.get(id); if (data) nodes.set(id, { ...data, bgColor, textColor }); });
    });
  }, []);

  const updateStickyColors = useCallback((stickyId: string, bgColor: string, textColor: string) => { const yStickies = yStickiesRef.current; if (!yStickies) return; const data = yStickies.get(stickyId); if (data) yStickies.set(stickyId, { ...data, bgColor, textColor }); }, []);
  const deleteSticky = useCallback((stickyId: string) => { const yStickies = yStickiesRef.current; if (!yStickies) return; ydocRef.current?.transact(() => { yStickies.delete(stickyId); }); setSelectedStickyId(null); }, []);
  const updateStickyText = useCallback((stickyId: string, text: string) => { const yStickies = yStickiesRef.current; if (!yStickies) return; const data = yStickies.get(stickyId); if (data) yStickies.set(stickyId, { ...data, text }); }, []);
  const updateStickyPosition = useCallback((stickyId: string, x: number, y: number) => { const yStickies = yStickiesRef.current; if (!yStickies) return; const data = yStickies.get(stickyId); if (data) yStickies.set(stickyId, { ...data, x, y }); }, []);
  const updateStickySize = useCallback((stickyId: string, width: number, height: number) => { const yStickies = yStickiesRef.current; if (!yStickies) return; const data = yStickies.get(stickyId); if (data) yStickies.set(stickyId, { ...data, width, height }); }, []);

  const alignNodes = useCallback((axis: 'vertical' | 'horizontal') => { const nodes = yNodesRef.current; if (!nodes || selectedNodeIds.length < 2) return; const refNodeId = selectedNodeIds[0]; const refNode = nodes.get(refNodeId); if (!refNode) return; const targetX = axis === 'vertical' ? refNode.x : undefined; const targetY = axis === 'horizontal' ? refNode.y : undefined; const idsToAlign = selectedNodeIds.slice(1); ydocRef.current?.transact(() => { idsToAlign.forEach((id: string) => { const data = nodes.get(id); if (!data) return; const updated = { ...data }; if (targetX !== undefined) updated.x = targetX; if (targetY !== undefined) updated.y = targetY; nodes.set(id, updated); }); }); }, [selectedNodeIds]);

  const handleImageUpload = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const fileExt = file.name.split('.').pop(); const fileName = `${crypto.randomUUID()}.${fileExt}`;
    const { data, error } = await supabase.storage.from('images').upload(fileName, file);
    if (error) { alert('画像のアップロードに失敗しました'); return; }
    const path = data.path;
    const img = new Image();
    img.src = URL.createObjectURL(file);
    img.onload = () => {
      const MAX_DIM = 200;
      let w = img.width, h = img.height;
      if (w > MAX_DIM || h > MAX_DIM) {
        const ratio = Math.min(MAX_DIM / w, MAX_DIM / h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      }
      const yImages = yImagesRef.current;
      if (!yImages || !ydocRef.current) return;
      const imageId = crypto.randomUUID();
      const container = scrollContainerRef.current;
      const centerX = container ? container.scrollLeft + container.clientWidth / 2 : 5000;
      const centerY = container ? container.scrollTop + container.clientHeight / 2 : 5000;
      ydocRef.current.transact(() => {
        yImages.set(imageId, {
          storagePath: path,
          x: centerX - w / 2,
          y: centerY - h / 2,
          width: w,
          height: h
        });
      });
    };
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const deleteImage = useCallback((imageId: string) => { const yImages = yImagesRef.current; if (!yImages) return; const image = yImages.get(imageId); if (image) { supabase.storage.from('images').remove([image.storagePath]); } ydocRef.current?.transact(() => { yImages.delete(imageId); }); setSelectedImageId(null); closeContextMenu(); }, [closeContextMenu]);
  const updateImagePosition = useCallback((imageId: string, x: number, y: number) => { const yImages = yImagesRef.current; if (!yImages) return; const data = yImages.get(imageId); if (data) yImages.set(imageId, { ...data, x, y }); }, []);

  const handleHeaderColorSelect = useCallback((bgColor: string, textColor: string) => {
    if (selectedNodeIds.length > 1) {
      updateMultipleNodeColors(selectedNodeIds, bgColor, textColor);
    } else if (selectedNodeId) {
      updateNodeColors(selectedNodeId, bgColor, textColor);
    } else if (selectedStickyId) {
      updateStickyColors(selectedStickyId, bgColor, textColor);
    }
  }, [selectedNodeId, selectedNodeIds, selectedStickyId, updateNodeColors, updateMultipleNodeColors, updateStickyColors]);

  const handleHeaderAddSticky = useCallback(() => {
    const container = scrollContainerRef.current;
    if (container) {
      const centerX = (container.scrollLeft + container.clientWidth / 2) / zoomLevel;
      const centerY = (container.scrollTop + container.clientHeight / 2) / zoomLevel;
      addSticky(centerX - DEFAULT_STICKY_WIDTH / 2, centerY - DEFAULT_STICKY_HEIGHT / 2);
    }
  }, [addSticky, zoomLevel]);

  const handleEdgeStyleChange = useCallback((newStyle: EdgeStyle) => {
    if (!ydocRef.current) return;
    const settings = ySettingsRef.current;
    if (settings) {
      ydocRef.current.transact(() => {
        settings.set('edgeStyle', newStyle);
      });
    }
    setEdgeStyle(newStyle);
  }, []);

  const fetchMapMembers = useCallback(async () => {
    if (!mapId) { setMapMembers([]); return; }
    const { data, error } = await supabase
      .from('map_members')
      .select('user_id, email')
      .eq('map_id', mapId);
    if (error) {
      console.error('メンバー取得エラー:', error);
      return;
    }
    setMapMembers(data || []);
  }, [mapId]);

  useEffect(() => {
    fetchMapMembers();
  }, [fetchMapMembers, mapId]);

  const initYjs = (room: string, initialTree?: MindNode): RealtimeChannel => {
    addLog(`initYjs: ${room}`);
    if (channelRef.current) { supabase.removeChannel(channelRef.current); channelRef.current = null; }
    ydocRef.current?.destroy(); if (undoManagerRef.current) { undoManagerRef.current.destroy(); undoManagerRef.current = null; }
    setConnectionStatus('接続中...'); setCanUndo(false); setCanRedo(false); setIsDirty(false);
    const ydoc = new Y.Doc(); ydocRef.current = ydoc;
    const yNodes = ydoc.getMap<YjsNodeData>('nodes'); yNodesRef.current = yNodes;
    const yEdges = ydoc.getMap<YjsEdgeData>('edges'); yEdgesRef.current = yEdges;
    const yImages = ydoc.getMap<YjsImageData>('images'); yImagesRef.current = yImages;
    const yStickies = ydoc.getMap<YjsStickyData>('stickies'); yStickiesRef.current = yStickies;
    const ySettings = ydoc.getMap<string>('settings'); ySettingsRef.current = ySettings;
    if (initialTree) { treeToYMap(initialTree, yNodes); yRootRef.current = initialTree.id; }
    else { const rootId = crypto.randomUUID(); yNodes.set(rootId, { text: '中心テーマ', x: 5000, y: 5000, children: [], independent: false, bgColor: '#f0f9ff', textColor: '#0369a1' }); yRootRef.current = rootId; }
    const updateReact = () => {
      if (yRootRef.current) { const tree = yMapToTree(yNodes, yRootRef.current); if (tree) setMindMap(tree); }
      const edgeList: EdgeData[] = []; yEdges.forEach((value: YjsEdgeData, key: string) => { edgeList.push({ id: key, sourceNodeId: value.sourceNodeId, sourcePoint: value.sourcePoint, targetNodeId: value.targetNodeId, targetPoint: value.targetPoint, arrow: value.arrow ?? 'none' }); }); setEdges(edgeList);
      const imageList: ImageData[] = []; yImages.forEach((value: YjsImageData, key: string) => { imageList.push({ id: key, storagePath: value.storagePath, x: value.x, y: value.y, width: value.width, height: value.height }); }); setImages(imageList);
      const stickyList: StickyData[] = []; yStickies.forEach((value: YjsStickyData, key: string) => { stickyList.push({ id: key, ...value }); }); setStickies(stickyList);
      const currentStyle = ySettings.get('edgeStyle') as EdgeStyle | undefined;
      if (currentStyle) setEdgeStyle(currentStyle);
    };
    yNodes.observe(updateReact); yEdges.observe(updateReact); yImages.observe(updateReact); yStickies.observe(updateReact); ySettings.observe(updateReact); updateReact();
    const undoManager = new Y.UndoManager([yNodes, yEdges, yImages, yStickies, ySettings]); undoManagerRef.current = undoManager;
    const updateUndoRedoState = () => { setCanUndo(undoManager.undoStack.length > 0); setCanRedo(undoManager.redoStack.length > 0); };
    undoManager.on('stack-item-added', updateUndoRedoState); undoManager.on('stack-item-popped', updateUndoRedoState); updateUndoRedoState();
    const channel = supabase.channel(`map-${room}`, { config: { broadcast: { ack: false } } });
    ydoc.on('update', (update: Uint8Array, origin: string) => {
      if(typeof window !== 'undefined') { try { localStorage.setItem(`mindmap-draft-${room}`, uint8ArrayToBase64(Y.encodeStateAsUpdate(ydoc))); } catch(e) {} }
      setIsDirty(true); if (origin === 'supabase' || origin === 'local') return;
      channel.send({ type: 'broadcast', event: 'yjs-update', payload: { update: uint8ArrayToBase64(update) } });
    });
    if(typeof window !== 'undefined') {
        try { const draft = localStorage.getItem(`mindmap-draft-${room}`); if (draft) { Y.applyUpdate(ydoc, base64ToUint8Array(draft), 'local'); addLog('未保存のバックアップを復元'); setIsDirty(true); } } catch(e) {}
    }
    channel.on('broadcast', { event: 'yjs-update' }, (msg: { payload: { update: string } }) => { const update = base64ToUint8Array(msg.payload.update); Y.applyUpdate(ydoc, update, 'supabase'); });
    channel.on('broadcast', { event: 'sync-step-1' }, (msg: { payload: { stateVector: string } }) => { const stateVector = base64ToUint8Array(msg.payload.stateVector); const update = Y.encodeStateAsUpdate(ydoc, stateVector); if (update.byteLength > 10) channel.send({ type: 'broadcast', event: 'sync-step-2', payload: { update: uint8ArrayToBase64(update) } }); });
    channel.on('broadcast', { event: 'sync-step-2' }, (msg: { payload: { update: string } }) => { Y.applyUpdate(ydoc, base64ToUint8Array(msg.payload.update), 'supabase'); addLog('差分同期完了'); });
    channel.on('broadcast', { event: 'awareness-update' }, (msg: { payload: { userId: string, state: AwarenessState | null } }) => { const { userId, state } = msg.payload; if (userId === myUserId) return; if (state === null) setAwarenessStates(prev => { const { [userId]: _, ...rest } = prev; return rest; }); else setAwarenessStates(prev => ({ ...prev, [userId]: state })); });
    const removeSelf = () => channel.send({ type: 'broadcast', event: 'awareness-update', payload: { userId: myUserId, state: null } }); 
    if(typeof window !== 'undefined') { window.addEventListener('beforeunload', removeSelf); }
    channel.subscribe((status: string, err?: Error) => {
      if (status === 'SUBSCRIBED') setConnectionStatus('接続済み'); else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') setConnectionStatus('切断'); else if (status === 'TIMED_OUT') setConnectionStatus('タイムアウト'); else setConnectionStatus('接続中...');
      if (err) console.error('Supabase Error:', err);
      if (status === 'SUBSCRIBED') { channel.send({ type: 'broadcast', event: 'sync-step-1', payload: { stateVector: uint8ArrayToBase64(Y.encodeStateVector(ydoc)) } }); broadcastAwareness(channel, myUserId, { email: myEmail, color: myColor, selectedNodeId, editingNodeId }); }
    });
    channelRef.current = channel; setRoomId(room); return channel;
  };

  useEffect(() => {
    let isMounted = true; let localChannel: RealtimeChannel | null = null;
    const setup = async () => {
      const hash = typeof window !== 'undefined' ? window.location.hash.slice(1) : ''; 
      let roomToJoin = hash;
      if (!hash) { roomToJoin = crypto.randomUUID(); if(typeof window !== 'undefined') window.history.replaceState(null, '', `#${roomToJoin}`); }
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

  const fetchMaps = useCallback(async () => {
    const { data, error } = await supabase
      .from('maps')
      .select('*, map_members(user_id, email)')
      .order('created_at', { ascending: false });
    if (error) { console.error('マップ一覧の取得に失敗しました:', error); return; }
    if (data) {
      const mapsWithMembers = data.map((map: any) => ({
        ...map,
        members: map.map_members ? map.map_members.filter((m: { user_id: string; email: string }) => m.email).map((m: { user_id: string; email: string }) => ({ user_id: m.user_id, email: m.email })) : []
      })) as MapRecord[];
      setSavedMaps(mapsWithMembers);
    }
  }, []);

  const handleSave = useCallback(async () => {
    if (!yNodesRef.current || !yRootRef.current || !roomId) {
      alert('保存に必要なデータが不足しています（roomIdが未設定）');
      return;
    }
    const tree = yMapToTree(yNodesRef.current, yRootRef.current);
    if (!tree) {
      alert('マップデータの変換に失敗しました');
      return;
    }
    setSaveMessage('保存中...');
    
    let resultData;
    let resultError;

    if (mapId) {
      const { data, error } = await supabase.from('maps').update({ 
        title: mapTitle, 
        data: tree, 
        updated_at: new Date().toISOString() 
      }).eq('id', mapId).select();
      resultData = data;
      resultError = error;
    } else {
      const { data, error } = await supabase.from('maps').insert([{ 
        title: mapTitle, 
        data: tree, 
        room_id: roomId, 
        user_id: user.id, 
        updated_at: new Date().toISOString() 
      }]).select();
      resultData = data;
      resultError = error;
    }

    if (resultError) {
      alert(`保存エラー: ${resultError.message}`);
      setSaveMessage(`保存に失敗: ${resultError.message}`);
      return;
    }
    if (resultData && resultData.length > 0) {
      setMapId(resultData[0].id);
      setSaveMessage('保存完了');
      setIsDirty(false);
      if(typeof window !== 'undefined') { try { localStorage.setItem(`mindmap-draft-${roomId}`, uint8ArrayToBase64(Y.encodeStateAsUpdate(ydocRef.current!))); } catch(e) {} }
      setTimeout(() => setSaveMessage(''), 2500);
      await fetchMaps();
      await fetchMapMembers();
    } else {
      alert('保存に成功しましたが、データが返ってきませんでした');
    }
  }, [mapId, mapTitle, roomId, user.id, fetchMaps, fetchMapMembers]);

  useEffect(() => {
    if (isSidebarOpen) {
      fetchMaps();
    }
  }, [isSidebarOpen, fetchMaps]);

  const handleLoadMap = useCallback((map: MapRecord) => {
    if (channelRef.current) supabase.removeChannel(channelRef.current);
    if(typeof window !== 'undefined') window.location.hash = map.room_id;
    setMapId(map.id);
    setMapTitle(map.title);
    initYjs(map.room_id, map.data);
  }, []);

  const handleNewMap = useCallback(() => {
    if (channelRef.current) supabase.removeChannel(channelRef.current);
    const newRoom = crypto.randomUUID();
    if(typeof window !== 'undefined') window.location.hash = newRoom;
    initYjs(newRoom);
    setMapId(null);
    setMapTitle('無題のマップ');
  }, []);

  const handleCopyMap = useCallback(async (map: MapRecord, e: ReactMouseEvent) => {
    e.stopPropagation();
    const newRoom = crypto.randomUUID();
    const { error: insertError } = await supabase.from('maps').insert({
      title: `${map.title} のコピー`,
      data: map.data,
      room_id: newRoom,
      user_id: user.id,
      updated_at: new Date().toISOString()
    });
    if (insertError) { alert('コピーに失敗しました'); return; }
    await fetchMaps();
  }, [user.id, fetchMaps]);

  const handleDeleteMap = useCallback(async (map: MapRecord, e: ReactMouseEvent) => {
    e.stopPropagation();
    if (typeof window !== 'undefined' && !window.confirm('マップを削除してもよろしいですか？')) return;
    const { error } = await supabase.from('maps').delete().eq('id', map.id);
    if (error) { alert('削除に失敗しました'); return; }
    if (mapId === map.id) {
      handleNewMap();
    }
    await fetchMaps();
  }, [mapId, handleNewMap, fetchMaps]);

  const handleShare = () => { if (!roomId) return; setShowInviteModal(true); };

  const handleInviteSubmit = async () => {
    if (!inviteEmail.trim() || !mapId) {
      if (!mapId) setInviteMessage('マップを保存してから招待してください');
      return;
    }
    setInviteLoading(true);
    setInviteMessage('');
    try {
      const { data: userIdData, error: rpcError } = await supabase.rpc('get_user_id_by_email', { p_email: inviteEmail.trim() });
      if (rpcError) throw rpcError;
      const invitedUserId = userIdData as string;
      if (!invitedUserId) {
        setInviteMessage('指定されたメールアドレスのユーザーが見つかりませんでした');
        return;
      }
      const { error: insertError } = await supabase.from('map_members').insert({
        map_id: mapId,
        user_id: invitedUserId,
        role: 'editor',
        email: inviteEmail.trim()
      });
      if (insertError) {
        if (insertError.code === '23505') {
          setInviteMessage('このユーザーは既に招待されています');
        } else {
          throw insertError;
        }
      } else {
        setInviteMessage('招待しました！');
        setInviteEmail('');
        await fetchMapMembers();
        await fetchMaps(); // サイドバーの共有ユーザー一覧も更新
      }
    } catch (err: unknown) {
      setInviteMessage('エラーが発生しました: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setInviteLoading(false);
    }
  };

  const handleMouseDownOnNode = useCallback((e: ReactMouseEvent, nodeId: string) => {
    if (e.button !== 0 || isSpacePressed) return; e.stopPropagation();
    const container = scrollContainerRef.current; if (!container) return;
    const coords = getCanvasCoords(e.clientX, e.clientY, container, zoomLevel);
    const node = mindMap ? findNodeById(mindMap, nodeId) : null; if (!node) return;
    const isMulti = selectedNodeIds.length > 1 && selectedNodeIds.includes(nodeId);
    if (isMulti) {
      groupDragStartMouse.current = { x: coords.x, y: coords.y };
      const initialPositions: Record<string, { x: number; y: number }> = {};
      if (!mindMap) return;
      selectedNodeIds.forEach((id: string) => { const n = findNodeById(mindMap, id); if (n) initialPositions[id] = { x: n.x, y: n.y }; });
      initialGroupDragPositions.current = initialPositions;
      setDragPositions(initialPositions);
      setDraggingNodeId(null); setDragTargetNodeId(null); setSelectedEdgeId(null); setSelectedImageId(null); setSelectedStickyId(null);
    } else {
      dragOffset.current = { x: coords.x - node.x, y: coords.y - node.y };
      setDragPositions(prev => ({ ...prev, [nodeId]: { x: node.x, y: node.y } }));
      setDraggingNodeId(nodeId); setDragTargetNodeId(null); setSelectedEdgeId(null); setSelectedImageId(null); setSelectedStickyId(null);
    }
  }, [mindMap, zoomLevel, selectedNodeIds, isSpacePressed]);

  const handleMouseDownOnImage = useCallback((e: ReactMouseEvent, imageId: string) => {
    if (e.button !== 0 || isSpacePressed) return; e.stopPropagation();
    const image = images.find((img: ImageData) => img.id === imageId); if (!image) return;
    const container = scrollContainerRef.current; if (!container) return;
    const coords = getCanvasCoords(e.clientX, e.clientY, container, zoomLevel);
    imageDragOffset.current = { x: coords.x - image.x, y: coords.y - image.y };
    setDraggingImageId(imageId); setSelectedImageId(imageId); setSelectedNodeId(null); setSelectedEdgeId(null); setSelectedStickyId(null);
  }, [images, zoomLevel, isSpacePressed]);

  const handleMouseDownOnSticky = useCallback((e: ReactMouseEvent, stickyId: string) => {
    if (e.button !== 0 || isSpacePressed) return; e.stopPropagation();
    const sticky = stickies.find((s: StickyData) => s.id === stickyId); if (!sticky) return;
    const container = scrollContainerRef.current; if (!container) return;
    const coords = getCanvasCoords(e.clientX, e.clientY, container, zoomLevel);
    stickyDragOffset.current = { x: coords.x - sticky.x, y: coords.y - sticky.y };
    setDraggingStickyId(stickyId); setSelectedStickyId(stickyId); setSelectedNodeId(null); setSelectedEdgeId(null); setSelectedImageId(null);
  }, [stickies, zoomLevel, isSpacePressed]);

  const handleResizeHandleMouseDown = useCallback((e: ReactMouseEvent, imageId: string, handle: string) => { e.stopPropagation(); e.preventDefault(); setResizingImageHandle({ imageId, handle }); }, []);
  const handleStickyResizeHandleMouseDown = useCallback((e: ReactMouseEvent, stickyId: string, handle: string) => { e.stopPropagation(); e.preventDefault(); setResizingStickyHandle({ stickyId, handle }); }, []);

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
      setSelectedStickyId(null);
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
      const { edgeId, endpoint } = editingEdgeEndpoint; const edge = edges.find((eg: EdgeData) => eg.id === edgeId); if (!edge) return;
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
    if (draggingStickyId) { updateStickyPosition(draggingStickyId, coords.x - stickyDragOffset.current.x, coords.y - stickyDragOffset.current.y); return; }
    if (resizingImageHandle) {
      const image = images.find((img: ImageData) => img.id === resizingImageHandle.imageId); if (!image) return;
      let newWidth = image.width, newHeight = image.height, newX = image.x, newY = image.y; const h = resizingImageHandle.handle;
      if (h.includes('e')) newWidth = Math.max(20, coords.x - image.x); if (h.includes('s')) newHeight = Math.max(20, coords.y - image.y);
      if (h.includes('w')) { const diff = image.x - coords.x; newWidth = Math.max(20, diff); newX = coords.x; }
      if (h.includes('n')) { const diff = image.y - coords.y; newHeight = Math.max(20, diff); newY = coords.y; }
      const yImages = yImagesRef.current; if (yImages) { ydocRef.current?.transact(() => { yImages.set(image.id, { ...image, width: newWidth, height: newHeight, x: newX, y: newY }); }); }
      return;
    }
    if (resizingStickyHandle) {
      const sticky = stickies.find((s: StickyData) => s.id === resizingStickyHandle.stickyId); if (!sticky) return;
      let newWidth = sticky.width, newHeight = sticky.height, newX = sticky.x, newY = sticky.y; const h = resizingStickyHandle.handle;
      if (h.includes('e')) newWidth = Math.max(100, coords.x - sticky.x); if (h.includes('s')) newHeight = Math.max(80, coords.y - sticky.y);
      if (h.includes('w')) { const diff = sticky.x - coords.x; newWidth = Math.max(100, diff); newX = coords.x; }
      if (h.includes('n')) { const diff = sticky.y - coords.y; newHeight = Math.max(80, diff); newY = coords.y; }
      updateStickySize(sticky.id, newWidth, newHeight);
      if (h.includes('w') || h.includes('n')) updateStickyPosition(sticky.id, newX, newY);
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
      selectedNodeIds.forEach((id: string) => { const initial = initialGroupDragPositions.current[id]; if (initial) newPositions[id] = { x: initial.x + deltaX, y: initial.y + deltaY }; });
      setDragPositions(newPositions); return;
    }
  }, [editingEdgeEndpoint, drawingEdge, draggingImageId, draggingStickyId, resizingImageHandle, resizingStickyHandle, selectionRect, draggingNodeId, selectedNodeIds, dragPositions, mindMap, edges, updateEdgeEndpoint, zoomLevel, updateImagePosition, updateStickyPosition, updateStickySize, images, stickies, isCanvasPanning]);

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
    if (draggingStickyId) { setDraggingStickyId(null); return; }
    if (resizingImageHandle) { setResizingImageHandle(null); return; }
    if (resizingStickyHandle) { setResizingStickyHandle(null); return; }
    if (selectionRect) {
      if (mindMap) { const selectedIds: string[] = []; const collectNodes = (node: MindNode) => { if (isNodeInRect(node, selectionRect)) selectedIds.push(node.id); node.children.forEach((c: MindNode) => collectNodes(c)); }; collectNodes(mindMap); if (selectedIds.length > 0) { setSelectedNodeId(selectedIds[0]); setSelectedNodeIds(selectedIds); } }
      setSelectionRect(null); return;
    }
    if (draggingNodeId) {
      const pos = dragPositions[draggingNodeId]; if (pos) updatePosition(draggingNodeId, pos.x, pos.y);
      if (dragTargetNodeId && dragTargetNodeId !== draggingNodeId) reparentNode(draggingNodeId, dragTargetNodeId);
      setDraggingNodeId(null); setDragTargetNodeId(null); setDragPositions(prev => { const { [draggingNodeId]: _, ...rest } = prev; return rest; }); return;
    }
    if (selectedNodeIds.length > 1 && Object.keys(dragPositions).length > 0) {
      const nodes = yNodesRef.current;
      if (nodes) { ydocRef.current?.transact(() => { selectedNodeIds.forEach((id: string) => { const pos = dragPositions[id]; if (pos && nodes.get(id)) nodes.set(id, { ...nodes.get(id)!, x: pos.x, y: pos.y }); }); }); }
      setDragPositions({}); initialGroupDragPositions.current = {}; return;
    }
  }, [editingEdgeEndpoint, drawingEdge, draggingImageId, draggingStickyId, resizingImageHandle, resizingStickyHandle, selectionRect, draggingNodeId, dragPositions, dragTargetNodeId, selectedNodeIds, mindMap, addEdge, updatePosition, reparentNode, isCanvasPanning]);

  useEffect(() => {
    const isAnyDrag = draggingNodeId !== null || editingEdgeEndpoint !== null || drawingEdge !== null || draggingImageId !== null || draggingStickyId !== null || resizingImageHandle !== null || resizingStickyHandle !== null || selectionRect !== null || isCanvasPanning || (selectedNodeIds.length > 1 && Object.keys(dragPositions).length > 0);
    if (isAnyDrag) { 
        if(typeof window !== 'undefined') {
            window.addEventListener('mousemove', handleMouseMove as EventListener); 
            window.addEventListener('mouseup', handleMouseUp); 
        }
        return () => { 
            if(typeof window !== 'undefined') {
                window.removeEventListener('mousemove', handleMouseMove as EventListener); 
                window.removeEventListener('mouseup', handleMouseUp); 
            }
        }; 
    }
  }, [draggingNodeId, editingEdgeEndpoint, drawingEdge, draggingImageId, draggingStickyId, resizingImageHandle, resizingStickyHandle, selectionRect, selectedNodeIds, dragPositions, handleMouseMove, handleMouseUp, isCanvasPanning]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (editingNodeId || editingStickyId) return;
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); handleSave(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); e.shiftKey ? handleRedo() : handleUndo(); return; }
    if (e.altKey && (e.ctrlKey || e.metaKey) && e.key === 'f') { e.preventDefault(); setZenMode(prev => !prev); return; }
    if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '-' || e.key === '=')) { e.preventDefault(); changeZoom(e.key === '-' ? -0.1 : 0.1); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedEdgeId && !selectedNodeId && !selectedImageId && !selectedStickyId) { e.preventDefault(); deleteEdge(selectedEdgeId); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedImageId && !selectedNodeId && !selectedEdgeId && !selectedStickyId) { e.preventDefault(); deleteImage(selectedImageId); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedStickyId && !selectedNodeId && !selectedEdgeId && !selectedImageId) { e.preventDefault(); deleteSticky(selectedStickyId); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNodeIds.length > 1 && !selectedEdgeId && !selectedImageId && !selectedStickyId) { e.preventDefault(); deleteMultipleNodes(selectedNodeIds); return; }
    
    if (!selectedNodeId) return;
    
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      const current = mindMap ? findNodeById(mindMap, selectedNodeId) : null;
      if (!current || !mindMap) return;
      let closest: MindNode | null = null;
      let minDist = Infinity;
      const allNodes = getAllNodes(mindMap);
      for (const n of allNodes) {
        if (n.id === selectedNodeId) continue;
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
      }
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
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const node = mindMap ? findNodeById(mindMap, selectedNodeId) : null;
      if (node?.independent) {
        addIndependentSibling(selectedNodeId, 'after');
      } else {
        addSiblingNode(selectedNodeId, 'after');
      }
      return;
    }
    if (e.key === 'Enter' && e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const node = mindMap ? findNodeById(mindMap, selectedNodeId) : null;
      if (node?.independent) {
        addIndependentSibling(selectedNodeId, 'before');
      } else {
        addSiblingNode(selectedNodeId, 'before');
      }
      return;
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); addParentNode(selectedNodeId); return; }
    if (e.key === 'Tab') { e.preventDefault(); addChildNode(selectedNodeId); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteNode(selectedNodeId); return; }
  }, [editingNodeId, editingStickyId, selectedNodeId, selectedNodeIds, selectedEdgeId, selectedImageId, selectedStickyId, mindMap, zoomLevel, handleSave, handleUndo, handleRedo, addChildNode, addSiblingNode, addIndependentSibling, addParentNode, deleteNode, deleteMultipleNodes, deleteEdge, deleteImage, deleteSticky, changeZoom]);

  const handleNodeContextMenu = useCallback((e: ReactMouseEvent, nodeId: string) => { e.preventDefault(); e.stopPropagation(); setContextMenu({ visible: true, x: e.clientX, y: e.clientY, type: 'node', nodeId }); setShowColorPalette(null); }, []);
  const handleCanvasContextMenu = useCallback((e: ReactMouseEvent) => { e.preventDefault(); const container = scrollContainerRef.current; if (!container) return; const coords = getCanvasCoords(e.clientX, e.clientY, container, zoomLevel); setContextMenu({ visible: true, x: e.clientX, y: e.clientY, type: 'canvas', canvasX: coords.x, canvasY: coords.y }); }, [zoomLevel]);
  const handleImageContextMenu = useCallback((e: ReactMouseEvent, imageId: string) => { e.preventDefault(); e.stopPropagation(); setSelectedImageId(imageId); setContextMenu({ visible: true, x: e.clientX, y: e.clientY, type: 'image', imageId }); }, []);
  const handleStickyContextMenu = useCallback((e: ReactMouseEvent, stickyId: string) => { e.preventDefault(); e.stopPropagation(); setSelectedStickyId(stickyId); setContextMenu({ visible: true, x: e.clientX, y: e.clientY, type: 'sticky', stickyId }); }, []);

  const executeContextAction = useCallback((action: string) => {
    closeContextMenu();
    if (contextMenu.type === 'node' && contextMenu.nodeId) {
      const nodeId = contextMenu.nodeId;
      const node = mindMap ? findNodeById(mindMap, nodeId) : null;
      switch (action) {
        case 'addChild': addChildNode(nodeId); break;
        case 'addSiblingAfter':
          if (node?.independent) addIndependentSibling(nodeId, 'after');
          else addSiblingNode(nodeId, 'after');
          break;
        case 'addSiblingBefore':
          if (node?.independent) addIndependentSibling(nodeId, 'before');
          else addSiblingNode(nodeId, 'before');
          break;
        case 'addParent': addParentNode(nodeId); break;
        case 'delete': deleteNode(nodeId); break;
        case 'alignVertical': alignNodes('vertical'); break;
        case 'alignHorizontal': alignNodes('horizontal'); break;
      }
    } else if (contextMenu.type === 'edge' && contextMenu.edgeId) {
      switch (action) { case 'deleteEdge': deleteEdge(contextMenu.edgeId); break; case 'arrowNone': updateEdgeArrow(contextMenu.edgeId, 'none'); break; case 'arrowStart': updateEdgeArrow(contextMenu.edgeId, 'start'); break; case 'arrowEnd': updateEdgeArrow(contextMenu.edgeId, 'end'); break; case 'arrowBoth': updateEdgeArrow(contextMenu.edgeId, 'both'); break; }
    } else if (contextMenu.type === 'image' && contextMenu.imageId) { if (action === 'deleteImage') deleteImage(contextMenu.imageId); }
    else if (contextMenu.type === 'sticky' && contextMenu.stickyId) {
      switch (action) {
        case 'deleteSticky': deleteSticky(contextMenu.stickyId); break;
        case 'changeColor': setShowColorPalette({ stickyId: contextMenu.stickyId, x: contextMenu.x, y: contextMenu.y }); break;
      }
    }
    else if (contextMenu.type === 'canvas') { 
      if (action === 'addNode' && contextMenu.canvasX !== undefined && contextMenu.canvasY !== undefined) addNodeAtPosition(contextMenu.canvasX, contextMenu.canvasY); 
      else if (action === 'addSticky' && contextMenu.canvasX !== undefined && contextMenu.canvasY !== undefined) addSticky(contextMenu.canvasX, contextMenu.canvasY); 
      else if (action === 'addImage') fileInputRef.current?.click(); 
    }
  }, [contextMenu, closeContextMenu, mindMap, addChildNode, addSiblingNode, addIndependentSibling, addParentNode, deleteNode, deleteEdge, updateEdgeArrow, addNodeAtPosition, addSticky, alignNodes, deleteImage, deleteSticky]);

  const handleNodeClick = useCallback((e: ReactMouseEvent, nodeId: string) => {
    e.stopPropagation(); if (showColorPalette) { setShowColorPalette(null); return; }
    const ctrlOrMeta = e.ctrlKey || e.metaKey;
    if (ctrlOrMeta) { setSelectedNodeIds(prev => prev.includes(nodeId) ? prev.filter((id: string) => id !== nodeId) : [...prev, nodeId]); }
    else { setSelectedNodeId(nodeId); setSelectedNodeIds([nodeId]); }
    setSelectedEdgeId(null); setSelectedImageId(null); setSelectedStickyId(null); closeContextMenu();
  }, [closeContextMenu, showColorPalette]);

  const handleNodeDoubleClick = useCallback((e: ReactMouseEvent, nodeId: string) => { e.stopPropagation(); setEditingNodeId(nodeId); }, []);
  const handleCanvasClick = () => { if (wasDraggingRef.current || isCanvasPanning) { wasDraggingRef.current = false; return; } closeContextMenu(); };
  const handleTextEditComplete = (nodeId: string, newText: string) => { const trimmed = newText.trim(); if (trimmed) updateText(nodeId, trimmed); setEditingNodeId(null); };
  const handleEdgeClick = useCallback((e: ReactMouseEvent, edgeId: string) => { e.stopPropagation(); setSelectedNodeId(null); setSelectedNodeIds([]); setSelectedEdgeId(edgeId); setSelectedImageId(null); setSelectedStickyId(null); closeContextMenu(); }, [closeContextMenu]);
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

  if (!mindMap) return <div className="flex items-center justify-center h-screen bg-slate-50 text-slate-500">Loading Map Data...</div>;
  const flatNodes = flattenTree(mindMap);

  const isAnyDragging = draggingNodeId !== null || isMultiDragging || isCanvasPanning || draggingStickyId !== null;

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

  // ★ 統合された参加者リストの生成
  const ownAwareness = awarenessStates[myUserId];
  const participantsMap = new Map<string, Participant>();

  // 1. 自分自身をマップに登録
  participantsMap.set(myUserId, {
    user_id: myUserId,
    email: myEmail,
    color: myColor,
    isOnline: true,
    isSelf: true,
    selectedNodeId: ownAwareness?.selectedNodeId ?? null,
    editingNodeId: ownAwareness?.editingNodeId ?? null,
  });

  // 2. DBから取得した招待メンバーを登録（初期状態はオフラインとして扱う）
  mapMembers.forEach((member) => {
    if (member.user_id !== myUserId) {
      participantsMap.set(member.user_id, {
        user_id: member.user_id,
        email: member.email,
        color: stringToColor(member.email),
        isOnline: false, // 後でオンラインなら上書きする
        isSelf: false,
        selectedNodeId: null,
        editingNodeId: null,
      });
    }
  });

  // 3. リアルタイムにオンラインのユーザーで上書き (招待されていないゲスト参加者もここで追加される)
  Object.entries(awarenessStates).forEach(([userId, state]) => {
    if (userId === myUserId) return;
    // 既存のユーザーがいればオンライン状態を更新、いなければ新規追加
    participantsMap.set(userId, {
      user_id: userId,
      email: state.email,
      color: state.color, // リアルタイムで共有された色を優先
      isOnline: true,
      isSelf: false,
      selectedNodeId: state.selectedNodeId,
      editingNodeId: state.editingNodeId,
    });
  });

  const allParticipants = Array.from(participantsMap.values());

  const statusColor = connectionStatus === '接続済み' ? 'bg-emerald-500' : (connectionStatus === '切断' || connectionStatus === 'タイムアウト' ? 'bg-rose-500' : 'bg-amber-500');
  const getImageUrl = (storagePath: string) => { const { data } = supabase.storage.from('images').getPublicUrl(storagePath); return data.publicUrl; };

  const canvasScrollClass = `w-full h-full overflow-auto pt-14 relative ${isSpacePressed ? (isCanvasPanning ? 'cursor-grabbing' : 'cursor-grab') : ''}`;
  const hideScrollbarStyle = { scrollbarWidth: 'none' as const, msOverflowStyle: 'none' as const, WebkitOverflowScrolling: 'touch', outline: 'none' };

  return (
    <div className="relative h-screen w-screen overflow-hidden flex bg-slate-50 text-slate-800" style={{ fontFamily: "'Inter', 'Noto Sans JP', sans-serif" }}>
      <style>{`.hide-scrollbar::-webkit-scrollbar { display: none; }`}</style>
      
      <input type="file" ref={fileInputRef} onChange={handleImageUpload} accept="image/*" className="hidden" />
      
      {/* 招待モーダル */}
      {showInviteModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md border border-slate-100">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-slate-800">チームメンバーを招待</h3>
              <button onClick={() => { setShowInviteModal(false); setInviteMessage(''); setInviteEmail(''); }} className="text-slate-400 hover:text-slate-600 transition-colors">&times;</button>
            </div>
            <p className="text-sm text-slate-500 mb-4">Googleアカウントのメールアドレスを入力して、共同編集者を招待します。</p>
            <div className="flex gap-2 mb-3">
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="colleague@example.com"
                className="flex-1 border border-slate-300 rounded-lg px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all"
                disabled={inviteLoading}
              />
              <button
                onClick={handleInviteSubmit}
                disabled={inviteLoading || !inviteEmail.trim() || !mapId}
                className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm"
              >
                {inviteLoading ? '招待中...' : '招待する'}
              </button>
            </div>
            {!mapId && (
              <p className="text-sm text-amber-600 mb-2 font-medium">⚠️ マップを保存してから招待してください。</p>
            )}
            {inviteMessage && (
              <p className={`text-sm font-medium ${inviteMessage.includes('エラー') || inviteMessage.includes('保存') ? 'text-rose-500' : 'text-emerald-600'}`}>
                {inviteMessage}
              </p>
            )}
          </div>
        </div>
      )}

      {/* モダナイズされたサイドバー */}
      <div 
        className={`absolute top-0 left-0 h-full bg-white border-r border-slate-200 shadow-xl z-[100] transition-all duration-300 flex flex-col ${isSidebarOpen ? 'w-[280px]' : 'w-0 overflow-hidden'}`}
      >
        <div style={{ minWidth: '280px' }} className="flex flex-col h-full">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-white">
            <h2 className="font-extrabold text-slate-800 tracking-tight flex items-center gap-2">
              <svg className="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
              MindMap Pro
            </h2>
            <button onClick={() => setIsSidebarOpen(false)} className="p-1.5 hover:bg-slate-100 rounded-md text-slate-400 transition-colors">✕</button>
          </div>
          
          <div className="p-4 border-b border-slate-100 flex flex-col gap-3">
            <button onClick={handleNewMap} className="flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white py-2.5 rounded-lg shadow-sm w-full font-medium transition-colors">
              <PlusIcon /> 新規マップ作成
            </button>
            <div className="flex gap-2">
              <button onClick={handleSave} className="flex-1 flex items-center justify-center gap-1.5 bg-white border border-slate-200 hover:bg-slate-50 py-2 rounded-lg text-sm font-medium text-slate-700 transition-colors shadow-sm">
                <SaveIcon /> 保存
              </button>
              <button onClick={handleShare} className="flex-1 flex items-center justify-center gap-1.5 bg-white border border-slate-200 hover:bg-slate-50 py-2 rounded-lg text-sm font-medium text-slate-700 transition-colors shadow-sm">
                <LinkIcon /> 共有
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3 bg-slate-50/50">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 px-1">Recent Maps</h3>
            {savedMaps.length === 0 ? (
              <div className="text-sm text-slate-400 text-center py-8 bg-white border border-slate-100 rounded-lg border-dashed">まだマップがありません</div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {savedMaps.map((map: MapRecord) => (
                  <div key={map.id} className={`group flex flex-col rounded-lg border transition-all ${mapId === map.id ? 'bg-indigo-50 border-indigo-200 shadow-sm' : 'bg-white border-transparent hover:border-slate-200 hover:shadow-sm'}`}>
                    <button 
                      onClick={() => handleLoadMap(map)} 
                      className={`w-full text-left px-3 py-2.5 rounded-t-lg text-sm transition-colors ${mapId === map.id ? 'text-indigo-900 font-semibold' : 'text-slate-700 font-medium'}`}
                    >
                      {map.title}
                    </button>
                    <div className="flex flex-col px-3 pb-2.5 pt-1 text-xs text-slate-400">
                      <div className="flex items-center justify-between w-full">
                        <div className="flex items-center gap-2">
                          <div className="flex -space-x-1.5">
                            {map.members && map.members.slice(0, 3).map((member, idx) => (
                              <div
                                key={idx}
                                className="w-5 h-5 rounded-full bg-slate-300 flex items-center justify-center text-[10px] font-bold text-white border-2 border-white"
                                style={{ backgroundColor: stringToColor(member.email) }}
                                title={member.email}
                              >
                                {getInitial(member.email)}
                              </div>
                            ))}
                            {map.members && map.members.length > 3 && (
                              <div className="w-5 h-5 rounded-full bg-slate-400 flex items-center justify-center text-[10px] font-bold text-white border-2 border-white">
                                +{map.members.length - 3}
                              </div>
                            )}
                          </div>
                          <div className={`flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity ${mapId === map.id ? 'opacity-100' : ''}`}>
                            <button 
                              onClick={(e) => handleCopyMap(map, e)}
                              className="p-1.5 hover:bg-slate-200 rounded text-slate-500 hover:text-slate-700 transition-colors"
                              title="コピー"
                            >
                              <CopyIcon />
                            </button>
                            <button 
                              onClick={(e) => handleDeleteMap(map, e)}
                              className="p-1.5 hover:bg-rose-100 rounded text-slate-500 hover:text-rose-600 transition-colors"
                              title="削除"
                            >
                              <TrashIcon />
                            </button>
                          </div>
                        </div>
                        <span className="text-[10px]">
                          {map.updated_at ? new Date(map.updated_at).toLocaleDateString('ja-JP', {month: 'short', day: 'numeric'}) : ''}
                        </span>
                      </div>
                      
                      {/* ★ 各マップに招待されているユーザー一覧を明記 */}
                      {map.members && map.members.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-slate-100/50 flex flex-col gap-1 w-full">
                          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Shared with:</span>
                          <div className="flex flex-wrap gap-1">
                            {map.members.map((member, idx) => (
                              <div key={idx} className="flex items-center gap-1 bg-slate-100 border border-slate-200 text-slate-600 px-1.5 py-0.5 rounded-sm max-w-full" title={member.email}>
                                <div className="w-1.5 h-1.5 rounded-full bg-slate-300 flex-shrink-0" />
                                <span className="text-[10px] truncate max-w-[120px]">{member.email}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          
          <div className="p-4 border-t border-slate-100 bg-white flex items-center justify-between">
            <div className="flex items-center gap-2.5 overflow-hidden">
               {user.user_metadata?.avatar_url ? <img src={user.user_metadata.avatar_url} alt="avatar" className="w-8 h-8 rounded-full border border-slate-200 flex-shrink-0" /> : <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0 shadow-sm" style={{ backgroundColor: myColor }}>{getInitial(myEmail)}</div>}
               <div className="flex flex-col min-w-0">
                 <span className="text-xs font-semibold text-slate-700 truncate" title={myEmail}>{myEmail.split('@')[0]}</span>
                 <span className="text-[10px] text-slate-400 truncate" title={myEmail}>{myEmail}</span>
               </div>
            </div>
            <button onClick={handleLogout} className="text-[10px] font-medium text-slate-500 hover:text-rose-600 bg-slate-50 hover:bg-rose-50 px-2.5 py-1.5 rounded-md transition-colors border border-slate-100 hover:border-rose-100 whitespace-nowrap">Logout</button>
          </div>
        </div>
      </div>

      <div className="flex-1 relative flex flex-col min-w-0 bg-slate-50">
        {!zenMode && (
          <div className="absolute top-0 left-0 right-0 z-50 flex items-center bg-white/90 backdrop-blur-md border-b border-slate-200 px-4 py-2 shadow-sm">
            <button onClick={() => setIsSidebarOpen(prev => !prev)} className={`p-2 mr-3 hover:bg-slate-100 rounded-lg text-slate-600 transition-colors ${isSidebarOpen ? 'bg-slate-100 text-indigo-600' : ''}`} title="サイドバーを開閉">
              <MenuIcon />
            </button>
            <input value={mapTitle} onChange={e => setMapTitle(e.target.value)} className="border border-transparent hover:border-slate-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 bg-transparent hover:bg-slate-50 focus:bg-white px-3 py-1.5 text-sm w-56 font-bold outline-none rounded-md transition-all text-slate-800" placeholder="無題のマップ" />
            
            <div className="w-px h-6 bg-slate-200 mx-3" />
            
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
              <button onClick={handleUndo} disabled={!canUndo} className="p-1.5 rounded-md hover:bg-white hover:shadow-sm disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:shadow-none text-slate-600 transition-all" title="元に戻す (Ctrl+Z)"><UndoIcon /></button>
              <button onClick={handleRedo} disabled={!canRedo} className="p-1.5 rounded-md hover:bg-white hover:shadow-sm disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:shadow-none text-slate-600 transition-all" title="やり直し (Ctrl+Shift+Z)"><RedoIcon /></button>
            </div>

            <div className="w-px h-6 bg-slate-200 mx-3" />

            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
              <button onClick={() => selectedNodeId && addChildNode(selectedNodeId)} disabled={!selectedNodeId} className="p-1.5 rounded-md hover:bg-white hover:shadow-sm disabled:opacity-40 text-indigo-600 flex items-center gap-1 transition-all" title="右に追加 (Tab)"><SubNodeIcon /><span className="text-[10px] font-bold">右</span></button>
              <button onClick={() => { if(!selectedNodeId) return; const n = mindMap ? findNodeById(mindMap, selectedNodeId) : null; if(n?.independent) addIndependentSibling(selectedNodeId, 'after'); else addSiblingNode(selectedNodeId, 'after'); }} disabled={!selectedNodeId} className="p-1.5 rounded-md hover:bg-white hover:shadow-sm disabled:opacity-40 text-indigo-600 flex items-center gap-1 transition-all" title="下に追加 (Enter)"><SiblingNodeIcon /><span className="text-[10px] font-bold">下</span></button>
              <button onClick={() => { if(!selectedNodeId) return; const n = mindMap ? findNodeById(mindMap, selectedNodeId) : null; if(n?.independent) addIndependentSibling(selectedNodeId, 'before'); else addSiblingNode(selectedNodeId, 'before'); }} disabled={!selectedNodeId} className="p-1.5 rounded-md hover:bg-white hover:shadow-sm disabled:opacity-40 text-indigo-600 flex items-center gap-1 transition-all" title="上に追加 (Shift+Enter)"><SiblingNodeIcon className="rotate-180" /><span className="text-[10px] font-bold">上</span></button>
              <button onClick={() => selectedNodeId && addParentNode(selectedNodeId)} disabled={!selectedNodeId} className="p-1.5 rounded-md hover:bg-white hover:shadow-sm disabled:opacity-40 text-indigo-600 flex items-center gap-1 transition-all" title="左に追加 (Ctrl+Enter)"><ParentNodeIcon /><span className="text-[10px] font-bold">左</span></button>
              <div className="w-px h-4 bg-slate-300 mx-1" />
              {selectedNodeIds.length >= 2 && (
                <>
                  <button onClick={() => alignNodes('vertical')} className="p-1.5 rounded-md hover:bg-white hover:shadow-sm text-slate-600 transition-all" title="垂直に整列"><AlignVIcon /></button>
                  <button onClick={() => alignNodes('horizontal')} className="p-1.5 rounded-md hover:bg-white hover:shadow-sm text-slate-600 transition-all" title="水平に整列"><AlignHIcon /></button>
                  <div className="w-px h-4 bg-slate-300 mx-1" />
                </>
              )}
              <button onClick={() => { if(selectedNodeIds.length > 1) deleteMultipleNodes(selectedNodeIds); else if(selectedNodeId) deleteNode(selectedNodeId); }} disabled={!selectedNodeId && selectedNodeIds.length === 0} className="p-1.5 rounded-md hover:bg-white hover:shadow-sm disabled:opacity-40 text-rose-500 transition-all" title="削除 (Delete/Backspace)"><TrashIcon /></button>
              <div className="w-px h-4 bg-slate-300 mx-1" />
              <button onClick={handleHeaderAddSticky} className="p-1.5 rounded-md hover:bg-white hover:shadow-sm text-amber-600 transition-all" title="付箋を追加"><StickyIcon /></button>
              <button onClick={() => fileInputRef.current?.click()} className="p-1.5 rounded-md hover:bg-white hover:shadow-sm text-sky-600 transition-all" title="画像を添付"><ImageIcon /></button>
            </div>

            <div className="flex items-center gap-1 ml-3">
              {COLOR_PALETTE.map(cp => (
                <button
                  key={cp.label}
                  onClick={() => handleHeaderColorSelect(cp.bg, cp.text)}
                  disabled={!selectedNodeId && !selectedStickyId && selectedNodeIds.length === 0}
                  className="w-6 h-6 rounded-full border border-slate-300 hover:scale-110 transition-transform disabled:opacity-30 disabled:cursor-not-allowed shadow-sm"
                  style={{ backgroundColor: cp.bg }}
                  title={cp.label}
                />
              ))}
            </div>

            <div className="w-px h-6 bg-slate-200 mx-3" />
            
            <div className="flex items-center gap-2">
              <select value={edgeStyle} onChange={e => handleEdgeStyleChange(e.target.value as EdgeStyle)} className="text-xs border border-slate-200 bg-slate-50 hover:bg-slate-100 rounded-md px-2 py-1.5 outline-none focus:ring-2 focus:ring-indigo-500 text-slate-700 cursor-pointer shadow-sm transition-colors font-medium">
                <option value="bezier">曲線スタイル</option>
                <option value="step">直角スタイル</option>
                <option value="straight">直線スタイル</option>
              </select>
            </div>

            <div className="flex items-center gap-2 ml-4">
              {isDirty && <span className="text-[10px] font-medium text-amber-700 bg-amber-50 px-2.5 py-1 rounded-md border border-amber-200 flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></div>未保存</span>}
              {saveMessage === '保存完了' && <span className="text-[10px] font-medium text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-200 flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>保存済み</span>}
            </div>

            <div className="ml-auto flex items-center gap-2 bg-slate-100 p-1 rounded-lg">
              <button onClick={scrollToHome} className="p-1.5 rounded-md hover:bg-white hover:shadow-sm text-slate-600 transition-all" title="ホーム位置に戻る"><HomeIcon /></button>
              <div className="w-px h-4 bg-slate-300 mx-0.5" />
              <button onClick={() => changeZoom(-0.1)} className="p-1.5 rounded-md hover:bg-white hover:shadow-sm text-slate-600 transition-all" title="縮小">−</button>
              <span className="text-xs text-slate-600 font-semibold px-2 w-14 text-center cursor-pointer" onClick={() => setZoomLevel(1.0)} title="100%に戻す">{Math.round(zoomLevel * 100)}%</span>
              <button onClick={() => changeZoom(0.1)} className="p-1.5 rounded-md hover:bg-white hover:shadow-sm text-slate-600 transition-all" title="拡大">＋</button>
            </div>
            
            <div className="w-px h-6 bg-slate-200 mx-3" />
            
            {/* ★ ヘッダー参加者表示 */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 px-2 py-1 bg-slate-50 rounded-md border border-slate-200 shadow-inner" title={connectionStatus}>
                <div className={`w-2 h-2 rounded-full ${statusColor} shadow-sm ${connectionStatus === '接続済み' ? 'animate-pulse' : ''}`} />
                <span className="text-[10px] font-medium text-slate-500 hidden md:block">{connectionStatus === '接続済み' ? 'Online' : 'Offline'}</span>
              </div>
              <div className="relative">
                <button onClick={() => setShowParticipants(!showParticipants)} className="flex items-center gap-1 hover:bg-slate-100 rounded-lg px-2 py-1.5 transition-colors border border-transparent hover:border-slate-200" title="参加者一覧">
                  <div className="flex -space-x-1.5">
                    {allParticipants.slice(0, 3).map((p) => (
                      <div key={p.user_id} className="relative">
                        <div 
                          className={`w-7 h-7 rounded-full border-2 border-white flex items-center justify-center text-[10px] font-bold text-white shadow-sm ${p.isSelf ? 'ring-2 ring-indigo-400 z-10' : ''} ${!p.isOnline ? 'opacity-50 grayscale' : ''}`} 
                          style={{ backgroundColor: p.color }} 
                          title={p.email}
                        >
                          {getInitial(p.email)}
                        </div>
                        <div className={`absolute -bottom-0.5 left-1/2 transform -translate-x-1/2 w-2 h-2 rounded-full border border-white ${p.isOnline ? 'bg-emerald-400' : 'bg-slate-300'}`}></div>
                      </div>
                    ))}
                    {allParticipants.length > 3 && (
                      <div className="w-7 h-7 rounded-full border-2 border-white bg-slate-200 flex items-center justify-center text-[10px] font-bold text-slate-600 shadow-sm">+{allParticipants.length - 3}</div>
                    )}
                  </div>
                </button>
                {showParticipants && (
                  <div className="absolute top-full right-0 mt-2 w-64 bg-white border border-slate-200 rounded-xl shadow-2xl p-4 z-50">
                    <h3 className="text-xs font-bold text-slate-500 mb-3 border-b border-slate-100 pb-2 uppercase tracking-wide">メンバー ({allParticipants.length})</h3>
                    <div className="space-y-3 max-h-64 overflow-y-auto">
                      {allParticipants.map((p) => (
                        <div key={p.user_id} className="flex items-center gap-3 text-sm">
                          <div className={`relative w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0 shadow-inner ${p.isSelf ? 'ring-2 ring-indigo-500 ring-offset-1' : ''} ${!p.isOnline ? 'opacity-50 grayscale' : ''}`} style={{ backgroundColor: p.color }}>
                            {getInitial(p.email)}
                            <div className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border border-white ${p.isOnline ? 'bg-emerald-400' : 'bg-slate-300'}`}></div>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className={`text-slate-800 font-medium truncate leading-tight ${!p.isOnline ? 'text-slate-400' : ''}`}>{p.email}{p.isSelf ? ' (You)' : ''}</div>
                            <div className="text-slate-400 text-[10px] mt-0.5">
                              {p.isOnline ? (p.editingNodeId ? '📝 編集中...' : p.selectedNodeId ? '👆 ノード選択中' : '🟢 オンライン') : '⚫ オフライン'}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <button onClick={() => setShowParticipants(false)} className="mt-4 text-xs font-medium text-slate-500 hover:text-slate-700 w-full text-center py-2 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200 transition-colors">閉じる</button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        
        {zenMode && <button onClick={() => setZenMode(false)} className="absolute top-4 right-4 z-50 bg-slate-900/80 backdrop-blur text-white border border-slate-700 rounded-full px-5 py-2 text-xs font-bold shadow-2xl hover:bg-slate-800 transition-all transform hover:scale-105">ZEN解除 (Alt+Cmd+F)</button>}
        
        {contextMenu.visible && !showColorPalette && (
          <div className="fixed z-[100] bg-white border border-slate-200 rounded-xl shadow-2xl py-1.5 text-sm min-w-[200px]" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={e => e.stopPropagation()}>
            {contextMenu.type === 'node' && contextMenu.nodeId && (<><button onClick={() => executeContextAction('addChild')} className="w-full text-left px-4 py-2.5 hover:bg-indigo-50 hover:text-indigo-700 font-medium flex items-center justify-between group transition-colors"><span>右に追加</span><span className="text-[10px] text-slate-400 group-hover:text-indigo-400 border border-slate-200 group-hover:border-indigo-200 rounded px-1">Tab</span></button><button onClick={() => executeContextAction('addSiblingAfter')} className="w-full text-left px-4 py-2.5 hover:bg-indigo-50 hover:text-indigo-700 font-medium flex items-center justify-between group transition-colors"><span>下に追加</span><span className="text-[10px] text-slate-400 group-hover:text-indigo-400 border border-slate-200 group-hover:border-indigo-200 rounded px-1">Enter</span></button><button onClick={() => executeContextAction('addSiblingBefore')} className="w-full text-left px-4 py-2.5 hover:bg-indigo-50 hover:text-indigo-700 font-medium flex items-center justify-between group transition-colors"><span>上に追加</span><span className="text-[10px] text-slate-400 group-hover:text-indigo-400 border border-slate-200 group-hover:border-indigo-200 rounded px-1">⇧Enter</span></button><button onClick={() => executeContextAction('addParent')} className="w-full text-left px-4 py-2.5 hover:bg-indigo-50 hover:text-indigo-700 font-medium flex items-center justify-between group transition-colors"><span>左に追加</span><span className="text-[10px] text-slate-400 group-hover:text-indigo-400 border border-slate-200 group-hover:border-indigo-200 rounded px-1">⌘Enter</span></button><div className="mx-2 my-1 border-b border-slate-100" /><button onClick={() => { setShowColorPalette({ nodeId: contextMenu.nodeId!, x: contextMenu.x, y: contextMenu.y }); setContextMenu(prev => ({ ...prev, visible: false })); }} className="w-full text-left px-4 py-2.5 hover:bg-slate-50 font-medium text-slate-700 transition-colors">色を変更</button><div className="mx-2 my-1 border-b border-slate-100" />{selectedNodeIds.length >= 2 && (<><button onClick={() => executeContextAction('alignVertical')} className="w-full text-left px-4 py-2.5 hover:bg-slate-50 font-medium text-slate-700 transition-colors">垂直に整列</button><button onClick={() => executeContextAction('alignHorizontal')} className="w-full text-left px-4 py-2.5 hover:bg-slate-50 font-medium text-slate-700 transition-colors">水平に整列</button><div className="mx-2 my-1 border-b border-slate-100" /></>)}<button onClick={() => executeContextAction('delete')} className="w-full text-left px-4 py-2.5 hover:bg-rose-50 text-rose-600 font-medium flex items-center justify-between group transition-colors"><span>削除</span><span className="text-[10px] text-rose-300 group-hover:text-rose-500 border border-rose-100 group-hover:border-rose-200 rounded px-1">⌫</span></button></>)}
            {contextMenu.type === 'edge' && (<><button onClick={() => executeContextAction('deleteEdge')} className="w-full text-left px-4 py-2.5 hover:bg-rose-50 text-rose-600 font-medium flex items-center justify-between group transition-colors"><span>線を削除</span><span className="text-[10px] text-rose-300 border border-rose-100 rounded px-1 group-hover:border-rose-200 group-hover:text-rose-500">⌫</span></button><div className="mx-2 my-1 border-b border-slate-100" /><div className="px-4 py-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">矢印の向き</div><button onClick={() => executeContextAction('arrowNone')} className="w-full text-left px-4 py-2 hover:bg-slate-50 font-medium text-slate-700 transition-colors">なし</button><button onClick={() => executeContextAction('arrowStart')} className="w-full text-left px-4 py-2 hover:bg-slate-50 font-medium text-slate-700 transition-colors">始点 →</button><button onClick={() => executeContextAction('arrowEnd')} className="w-full text-left px-4 py-2 hover:bg-slate-50 font-medium text-slate-700 transition-colors">終点 →</button><button onClick={() => executeContextAction('arrowBoth')} className="w-full text-left px-4 py-2 hover:bg-slate-50 font-medium text-slate-700 transition-colors">両方 ⇄</button></>)}
            {contextMenu.type === 'image' && (<><button onClick={() => executeContextAction('deleteImage')} className="w-full text-left px-4 py-2.5 hover:bg-rose-50 text-rose-600 font-medium transition-colors">画像を削除</button></>)}
            {contextMenu.type === 'sticky' && contextMenu.stickyId && (<><button onClick={() => executeContextAction('changeColor')} className="w-full text-left px-4 py-2.5 hover:bg-slate-50 font-medium text-slate-700 transition-colors">色を変更</button><div className="mx-2 my-1 border-b border-slate-100" /><button onClick={() => executeContextAction('deleteSticky')} className="w-full text-left px-4 py-2.5 hover:bg-rose-50 text-rose-600 font-medium transition-colors">付箋を削除</button></>)}
            {contextMenu.type === 'canvas' && (<><button onClick={() => executeContextAction('addNode')} className="w-full text-left px-4 py-2.5 hover:bg-slate-50 font-medium text-slate-700 transition-colors">独立トピックを追加</button><button onClick={() => executeContextAction('addSticky')} className="w-full text-left px-4 py-2.5 hover:bg-slate-50 font-medium text-slate-700 transition-colors">付箋を追加</button><button onClick={() => executeContextAction('addImage')} className="w-full text-left px-4 py-2.5 hover:bg-slate-50 font-medium text-slate-700 transition-colors">画像を添付</button></>)}
          </div>
        )}
        {showColorPalette && (
          <div className="fixed z-[110] bg-white border border-slate-200 rounded-xl shadow-2xl p-4 text-sm" style={{ left: showColorPalette.x, top: showColorPalette.y }} onClick={e => e.stopPropagation()}>
            <div className="text-xs font-bold text-slate-500 mb-3 text-center uppercase tracking-wide">カラーパレット</div>
            <div className="grid grid-cols-4 gap-3 mb-4">{COLOR_PALETTE.map((cp: { bg: string; text: string; label: string }, idx: number) => (<button key={idx} className="w-10 h-10 rounded-full border border-slate-200 hover:scale-110 transition-transform shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500" style={{ backgroundColor: cp.bg, boxShadow: `inset 0 0 0 1px rgba(0,0,0,0.05), 0 0 0 2px ${cp.text}` }} title={cp.label} onClick={() => { 
              if(showColorPalette.nodeId && selectedNodeIds.length > 1) updateMultipleNodeColors(selectedNodeIds, cp.bg, cp.text);
              else if(showColorPalette.nodeId) updateNodeColors(showColorPalette.nodeId, cp.bg, cp.text); 
              else if(showColorPalette.stickyId) updateStickyColors(showColorPalette.stickyId, cp.bg, cp.text); 
              setShowColorPalette(null); closeContextMenu(); 
            }} />))}</div>
            <button onClick={() => setShowColorPalette(null)} className="w-full py-2.5 text-xs font-bold text-slate-600 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors">キャンセル</button>
          </div>
        )}
        
        <div 
          ref={scrollContainerRef} 
          className={`${canvasScrollClass} hide-scrollbar bg-slate-50`} 
          tabIndex={0} 
          onKeyDown={handleKeyDown} 
          onClick={handleCanvasClick} 
          onContextMenu={handleCanvasContextMenu} 
          onMouseDown={handleCanvasMouseDown} 
          onDoubleClick={handleCanvasDoubleClick}
          style={hideScrollbarStyle as React.CSSProperties}
        >
          <div 
            className="relative" 
            style={{ 
              width: '10000px', 
              height: '10000px', 
              transform: `scale(${zoomLevel})`, 
              transformOrigin: '0 0',
              backgroundImage: 'radial-gradient(circle, #cbd5e1 1.5px, transparent 1.5px)',
              backgroundSize: '32px 32px',
              backgroundColor: '#f8fafc'
            }} 
            onContextMenu={handleCanvasContextMenu}
          >
            {showFloatingToolbar && floatingToolbarPos && (
              <div 
                className="absolute z-[60] bg-slate-800 rounded-lg shadow-xl border border-slate-700 flex items-center p-1.5 gap-1.5"
                style={{
                  left: floatingToolbarPos.x,
                  top: floatingToolbarPos.y - NODE_HEIGHT / 2 - 50,
                  transform: 'translate(-50%, 0)',
                  animation: 'fadeIn 0.15s ease-out'
                }}
                onClick={e => e.stopPropagation()}
                onMouseDown={e => e.stopPropagation()}
              >
                <style>{`@keyframes fadeIn { from { opacity: 0; transform: translate(-50%, 8px); } to { opacity: 1; transform: translate(-50%, 0); } }`}</style>
                <button onClick={() => setShowColorPalette({ nodeId: selectedNodeId!, x: window.innerWidth / 2, y: window.innerHeight / 2 })} className="p-1.5 hover:bg-slate-700 rounded-md text-slate-300 hover:text-white transition-colors" title="色を変更"><PaletteIcon /></button>
                <div className="w-px h-5 bg-slate-600 mx-0.5" />
                <button onClick={() => addChildNode(selectedNodeId!)} className="p-1.5 hover:bg-indigo-900/50 rounded-md text-indigo-300 hover:text-indigo-200 flex items-center gap-1 transition-colors" title="右に追加 (Tab)"><SubNodeIcon /><span className="text-[10px] font-bold">右</span></button>
                <button onClick={() => addSiblingNode(selectedNodeId!, 'after')} className="p-1.5 hover:bg-indigo-900/50 rounded-md text-indigo-300 hover:text-indigo-200 flex items-center gap-1 transition-colors" title="下に追加 (Enter)"><SiblingNodeIcon /><span className="text-[10px] font-bold">下</span></button>
                <div className="w-px h-5 bg-slate-600 mx-0.5" />
                <button onClick={() => deleteNode(selectedNodeId!)} className="p-1.5 hover:bg-rose-900/50 rounded-md text-rose-400 hover:text-rose-300 transition-colors" title="削除 (Delete/Backspace)"><TrashIcon /></button>
              </div>
            )}

            {/* 画像（付箋の上） */}
            {images.map((image: ImageData) => (
              <div
                key={image.id}
                className={`absolute cursor-move border-2 rounded-lg overflow-hidden transition-shadow ${selectedImageId === image.id ? 'border-indigo-500 shadow-2xl ring-4 ring-indigo-500/20' : 'border-transparent shadow-md hover:shadow-lg'}`}
                style={{ left: image.x, top: image.y, width: image.width, height: image.height, zIndex: 6 }}
                onMouseDown={(e) => handleMouseDownOnImage(e as ReactMouseEvent, image.id)}
                onContextMenu={(e) => handleImageContextMenu(e as ReactMouseEvent, image.id)}
                onClick={(e) => e.stopPropagation()}
              >
                <img src={getImageUrl(image.storagePath)} alt="" className="w-full h-full object-contain pointer-events-none" />
                {selectedImageId === image.id && (
                  <>
                    <div className="absolute -top-1.5 -left-1.5 w-4 h-4 bg-white border-2 border-indigo-600 rounded-full cursor-nw-resize shadow-md" onMouseDown={(e) => handleResizeHandleMouseDown(e as ReactMouseEvent, image.id, 'nw')} />
                    <div className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-white border-2 border-indigo-600 rounded-full cursor-ne-resize shadow-md" onMouseDown={(e) => handleResizeHandleMouseDown(e as ReactMouseEvent, image.id, 'ne')} />
                    <div className="absolute -bottom-1.5 -left-1.5 w-4 h-4 bg-white border-2 border-indigo-600 rounded-full cursor-sw-resize shadow-md" onMouseDown={(e) => handleResizeHandleMouseDown(e as ReactMouseEvent, image.id, 'sw')} />
                    <div className="absolute -bottom-1.5 -right-1.5 w-4 h-4 bg-white border-2 border-indigo-600 rounded-full cursor-se-resize shadow-md" onMouseDown={(e) => handleResizeHandleMouseDown(e as ReactMouseEvent, image.id, 'se')} />
                  </>
                )}
              </div>
            ))}

            {/* 付箋 */}
            {stickies.map((sticky: StickyData) => {
              const isEditing = editingStickyId === sticky.id;
              return (
                <div
                  key={sticky.id}
                  className={`absolute cursor-move rounded-sm overflow-visible transition-shadow group ${selectedStickyId === sticky.id ? 'ring-4 ring-indigo-500/20 shadow-2xl' : 'shadow-lg hover:shadow-xl'}`}
                  style={{ 
                    left: sticky.x, top: sticky.y, width: sticky.width, height: sticky.height, zIndex: 5,
                  }}
                  onMouseDown={(e) => handleMouseDownOnSticky(e as ReactMouseEvent, sticky.id)}
                  onContextMenu={(e) => handleStickyContextMenu(e as ReactMouseEvent, sticky.id)}
                  onDoubleClick={(e) => { e.stopPropagation(); setEditingStickyId(sticky.id); }}
                  onClick={(e) => { e.stopPropagation(); if(!draggingStickyId) { setSelectedStickyId(sticky.id); setSelectedNodeId(null); setSelectedEdgeId(null); setSelectedImageId(null); } }}
                >
                  {/* 付箋の影 (::before) */}
                  <div className="absolute -bottom-1.5 right-2 w-[70%] h-[50%] -z-10 opacity-40" style={{ backgroundColor: 'rgba(0,0,0,0.3)', transform: 'rotate(3deg)', filter: 'blur(6px)' }} />
                  
                  {/* 付箋本体 */}
                  <div className="relative w-full h-full rounded-sm flex flex-col p-3" style={{ backgroundColor: sticky.bgColor, color: sticky.textColor, boxShadow: '1px 2px 4px rgba(0,0,0,0.05)' }}>
                    {/* 左上折り目 */}
                    <div className="absolute top-0 left-0 w-0 h-0 border-r-[16px] border-r-transparent border-b-[16px] rounded-br-sm" style={{ borderBottomColor: 'rgba(0,0,0,0.08)' }} />
                    
                    <div className="flex-1 flex items-start overflow-hidden">
                      {isEditing ? (
                        <textarea
                          autoFocus
                          className="w-full h-full resize-none bg-transparent border-none outline-none text-sm font-medium pointer-events-auto"
                          defaultValue={sticky.text}
                          onBlur={(e) => { const trimmed = e.currentTarget.value.trim(); updateStickyText(sticky.id, trimmed); setEditingStickyId(null); }}
                          onKeyDown={(e) => { if (e.key === 'Escape') setEditingStickyId(null); }}
                          onMouseDown={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <div className="w-full h-full whitespace-pre-wrap overflow-auto text-sm font-medium cursor-text select-none pointer-events-none">
                          {sticky.text}
                        </div>
                      )}
                    </div>
                    {selectedStickyId === sticky.id && !isEditing && (
                      <div className="flex justify-end gap-1 mt-1 pointer-events-auto">
                        <button onClick={(e) => { e.stopPropagation(); setShowColorPalette({ stickyId: sticky.id, x: window.innerWidth / 2, y: window.innerHeight / 2 }); }} className="p-1 hover:bg-black/10 rounded">
                          <PaletteIcon />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); deleteSticky(sticky.id); }} className="p-1 hover:bg-black/10 rounded text-rose-500">
                          <TrashIcon />
                        </button>
                      </div>
                    )}
                  </div>
                  
                  {selectedStickyId === sticky.id && (
                    <>
                      <div className="absolute -top-1.5 -left-1.5 w-4 h-4 bg-white border-2 border-indigo-600 rounded-full cursor-nw-resize shadow-md" onMouseDown={(e) => handleStickyResizeHandleMouseDown(e as ReactMouseEvent, sticky.id, 'nw')} />
                      <div className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-white border-2 border-indigo-600 rounded-full cursor-ne-resize shadow-md" onMouseDown={(e) => handleStickyResizeHandleMouseDown(e as ReactMouseEvent, sticky.id, 'ne')} />
                      <div className="absolute -bottom-1.5 -left-1.5 w-4 h-4 bg-white border-2 border-indigo-600 rounded-full cursor-sw-resize shadow-md" onMouseDown={(e) => handleStickyResizeHandleMouseDown(e as ReactMouseEvent, sticky.id, 'sw')} />
                      <div className="absolute -bottom-1.5 -right-1.5 w-4 h-4 bg-white border-2 border-indigo-600 rounded-full cursor-se-resize shadow-md" onMouseDown={(e) => handleStickyResizeHandleMouseDown(e as ReactMouseEvent, sticky.id, 'se')} />
                    </>
                  )}
                </div>
              );
            })}
            <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 1 }}>
              <defs>
                <marker id="arrowStart" markerWidth="10" markerHeight="10" refX="2" refY="5" orient="auto-start-reverse"><polygon points="0,0 10,5 0,10" fill="#94a3b8" /></marker>
                <marker id="arrowEnd" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto"><polygon points="0,0 10,5 0,10" fill="#94a3b8" /></marker>
                <marker id="arrowStartActive" markerWidth="10" markerHeight="10" refX="2" refY="5" orient="auto-start-reverse"><polygon points="0,0 10,5 0,10" fill="#6366f1" /></marker>
                <marker id="arrowEndActive" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto"><polygon points="0,0 10,5 0,10" fill="#6366f1" /></marker>
              </defs>
              
              {flatNodes.filter((fn: FlatNode) => fn.parentId && fn.parentX !== undefined && fn.parentY !== undefined && !fn.independent).map((fn: FlatNode) => { 
                const parentPos = getNodeDisplayPos(fn.parentId as string, mindMap, dragPositions, draggingNodeId); 
                const childPos = getNodeDisplayPos(fn.id, mindMap, dragPositions, draggingNodeId); 
                if (!parentPos || !childPos) return null; 
                const dx = childPos.x - parentPos.x, dy = childPos.y - parentPos.y; 
                let parentPoint: ConnectionPoint, childPoint: ConnectionPoint; 
                if (Math.abs(dx) > Math.abs(dy)) { parentPoint = dx > 0 ? 'right' : 'left'; childPoint = dx > 0 ? 'left' : 'right'; } 
                else { parentPoint = dy > 0 ? 'bottom' : 'top'; childPoint = dy > 0 ? 'top' : 'bottom'; } 
                const startPt = getConnectionPoint(parentPos.x, parentPos.y, parentPoint); 
                const endPt = getConnectionPoint(childPos.x, childPos.y, childPoint); 
                const pathD = getEdgePath(startPt, endPt, parentPoint, childPoint, edgeStyle);
                const edgeId = `parent-edge-${fn.id}`;
                const isSelected = selectedEdgeId === edgeId;

                return (
                  <g key={edgeId} className="pointer-events-auto">
                    <path d={pathD} fill="none" stroke="transparent" strokeWidth={20} className="cursor-pointer" onClick={(e) => handleEdgeClick(e as ReactMouseEvent, edgeId)} onContextMenu={(e) => handleEdgeContextMenu(e as ReactMouseEvent, edgeId)} />
                    <path d={pathD} fill="none" stroke={isSelected ? '#6366f1' : '#cbd5e1'} strokeWidth={isSelected ? 4 : 3} className={`pointer-events-none ${isAnyDragging ? '' : 'transition-all duration-300 ease-out'} ${isSelected ? 'drop-shadow-md' : ''}`} />
                  </g>
                ); 
              })}

              {edgeLines.map((el: any) => { 
                const markerStart = el.arrow === 'start' || el.arrow === 'both' ? (el.selected ? 'url(#arrowStartActive)' : 'url(#arrowStart)') : 'none'; 
                const markerEnd = el.arrow === 'end' || el.arrow === 'both' ? (el.selected ? 'url(#arrowEndActive)' : 'url(#arrowEnd)') : 'none'; 
                return (
                  <g key={el.id} className="pointer-events-auto">
                    <path d={el.pathD} fill="none" stroke="transparent" strokeWidth={20} className="cursor-pointer" onClick={(e) => handleEdgeClick(e as ReactMouseEvent, el.id)} onContextMenu={(e) => handleEdgeContextMenu(e as ReactMouseEvent, el.id)} />
                    <path d={el.pathD} fill="none" stroke={el.selected ? '#6366f1' : '#94a3b8'} strokeWidth={el.selected ? 4 : 3} markerStart={markerStart} markerEnd={markerEnd} className={`${el.selected ? 'drop-shadow-md' : 'pointer-events-none'} ${isAnyDragging ? '' : 'transition-all duration-300 ease-out'}`} onClick={el.selected ? undefined : (e) => handleEdgeClick(e as ReactMouseEvent, el.id)} onContextMenu={(e) => handleEdgeContextMenu(e as ReactMouseEvent, el.id)} />
                    {el.selected && (<>
                      <circle cx={el.sourceX} cy={el.sourceY} r={8} fill="#ffffff" stroke="#6366f1" strokeWidth={3} className="cursor-grab pointer-events-auto hover:scale-125 transition-transform shadow-md" onMouseDown={(e) => handleEdgeEndpointMouseDown(e as ReactMouseEvent, el.id, 'source')} />
                      <circle cx={el.targetX} cy={el.targetY} r={8} fill="#ffffff" stroke="#6366f1" strokeWidth={3} className="cursor-grab pointer-events-auto hover:scale-125 transition-transform shadow-md" onMouseDown={(e) => handleEdgeEndpointMouseDown(e as ReactMouseEvent, el.id, 'target')} />
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
                  fill="none" stroke="#818cf8" strokeWidth={4} strokeDasharray="8,8" className="pointer-events-none drop-shadow-sm" 
                />
              )}
              
              {selectionRect && (
                <rect
                  x={Math.min(selectionRect.x1, selectionRect.x2)}
                  y={Math.min(selectionRect.y1, selectionRect.y2)}
                  width={Math.abs(selectionRect.x2 - selectionRect.x1)}
                  height={Math.abs(selectionRect.y2 - selectionRect.y1)}
                  fill="rgba(99, 102, 241, 0.15)"
                  stroke="#6366f1"
                  strokeWidth={2}
                  strokeDasharray="6 6"
                  className="rounded-sm"
                />
              )}
            </svg>
            <RecursiveNode node={mindMap} selectedNodeId={selectedNodeId} selectedNodeIds={selectedNodeIds} editingNodeId={editingNodeId} draggingNodeId={draggingNodeId} dragPositions={dragPositions} dragTargetNodeId={dragTargetNodeId} isMultiDragging={isMultiDragging} awarenessStates={awarenessStates} myUserId={myUserId} onNodeClick={handleNodeClick} onNodeDoubleClick={handleNodeDoubleClick} onMouseDownOnNode={handleMouseDownOnNode} onTextEditComplete={handleTextEditComplete} onContextMenu={handleNodeContextMenu} onConnectionPointMouseDown={handleConnectionPointMouseDown} depth={0} isAnyDragging={isAnyDragging} />
          </div>
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
  const remoteEditors = Object.entries(awarenessStates).filter(([, state]: [string, AwarenessState]) => state.editingNodeId === node.id).map(([, state]: [string, AwarenessState]) => state);
  const remoteSelectors = Object.entries(awarenessStates).filter(([, state]: [string, AwarenessState]) => state.selectedNodeId === node.id && state.editingNodeId !== node.id).map(([, state]: [string, AwarenessState]) => state);
  
  const depthTextClass = depth === 0 ? 'text-lg font-extrabold tracking-tight' : (depth === 1 ? 'text-base font-bold' : 'text-sm font-semibold');
  const depthShadowClass = depth === 0 ? 'shadow-xl shadow-slate-200/50' : (depth === 1 ? 'shadow-lg shadow-slate-200/40' : 'shadow-md hover:shadow-lg');
  const activeShadowClass = isSelected ? 'shadow-2xl shadow-indigo-500/30' : depthShadowClass;
  
  const borderColorClass = isTarget ? 'border-emerald-500 border-2 ring-4 ring-emerald-500/20' : (isSelected ? (isSingleSelected ? 'border-indigo-600 ring-4 ring-indigo-600/20' : 'border-purple-600 ring-4 ring-purple-600/20') : 'border-transparent');
  const connectionPoints: ConnectionPoint[] = ['top', 'right', 'bottom', 'left'];

  return (
    <>
      <div
        className={`absolute flex items-center justify-center rounded-2xl border-2 px-5 py-3 cursor-pointer select-none ${isAnyDragging ? '' : 'transition-all duration-300 ease-out'} ${activeShadowClass} ${borderColorClass} ${isEditing ? 'bg-amber-50 ring-4 ring-amber-400/30 border-amber-400' : ''} ${!isSelected && !isTarget && !isEditing ? 'hover:-translate-y-0.5 hover:border-slate-300' : ''}`}
        style={{
          left: displayPos.x - NODE_WIDTH/2, top: displayPos.y - NODE_HEIGHT/2,
          width: NODE_WIDTH, height: NODE_HEIGHT, zIndex: 10 + depth,
          backgroundColor: node.bgColor || '#ffffff',
          borderColor: isSelected || isEditing || isTarget ? undefined : (node.textColor || '#0ea5e9'),
          color: node.textColor || '#0f172a',
        }}
        onClick={e => onNodeClick(e, node.id)} onDoubleClick={e => onNodeDoubleClick(e, node.id)} onMouseDown={e => onMouseDownOnNode(e, node.id)} onContextMenu={e => onContextMenu(e, node.id)}
      >
        {isEditing ? (
          <input ref={inputRef} className={`w-full h-full bg-transparent text-center outline-none border-none focus:ring-0 ${depthTextClass} text-slate-800`} defaultValue={node.text} onBlur={handleBlur} onKeyDown={handleInputKeyDown} onClick={e => e.stopPropagation()} />
        ) : (
          <span className={`${depthTextClass} truncate block max-w-full`} style={{ color: node.textColor || '#1e293b' }}>{node.text}</span>
        )}
        {remoteEditors.length > 0 && <div className="absolute -top-2.5 -right-2.5 flex -space-x-1.5">{remoteEditors.map((editor: AwarenessState, i: number) => <div key={i} className="w-5 h-5 rounded-full border-2 border-white shadow-md animate-pulse" style={{ backgroundColor: editor.color }} title={`${editor.email} が編集中`} />)}</div>}
        {remoteSelectors.length > 0 && remoteEditors.length === 0 && <div className="absolute -top-2.5 -right-2.5 flex -space-x-1.5">{remoteSelectors.map((selector: AwarenessState, i: number) => <div key={i} className="w-4 h-4 rounded-full border-2 border-white opacity-80 shadow-sm" style={{ backgroundColor: selector.color }} title={`${selector.email} が選択中`} />)}</div>}
      </div>
      {isSingleSelected && !isMultiDragging && connectionPoints.map((point: ConnectionPoint) => { const pt = getConnectionPoint(displayPos.x, displayPos.y, point); return <div key={point} className={`absolute w-4 h-4 bg-white border-2 border-indigo-600 rounded-full cursor-crosshair hover:scale-150 hover:bg-indigo-50 shadow-md ${isAnyDragging ? '' : 'transition-all duration-300 ease-out'}`} style={{ left: pt.x-8, top: pt.y-8, zIndex: 20 + depth }} onMouseDown={e => onConnectionPointMouseDown(e, node.id, point)} />; })}
      {node.children.map((child: MindNode) => (<RecursiveNode key={child.id} node={child} selectedNodeId={selectedNodeId} selectedNodeIds={selectedNodeIds} editingNodeId={editingNodeId} draggingNodeId={draggingNodeId} dragPositions={dragPositions} dragTargetNodeId={dragTargetNodeId} isMultiDragging={isMultiDragging} awarenessStates={awarenessStates} myUserId={myUserId} onNodeClick={onNodeClick} onNodeDoubleClick={onNodeDoubleClick} onMouseDownOnNode={onMouseDownOnNode} onTextEditComplete={onTextEditComplete} onContextMenu={onContextMenu} onConnectionPointMouseDown={onConnectionPointMouseDown} depth={depth+1} isAnyDragging={isAnyDragging} />))}
    </>
  );
};

export default App;