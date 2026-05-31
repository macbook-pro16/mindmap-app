"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { KeyboardEvent, MouseEvent as ReactMouseEvent, ChangeEvent, DragEvent } from 'react';
import * as Y from 'yjs';
import { supabase } from './supabaseClient';
import type { RealtimeChannel, User } from '@supabase/supabase-js';

// ==================== 型定義 ====================
export interface YjsNodeData {
  text: string;
  x: number;
  y: number;
  independent?: boolean;
  bgColor?: string;
  textColor?: string;
  groupId?: string;
  zIndex?: number;
  width?: number;
  height?: number;
  fontSize?: number;
  collapsed?: boolean;
  imageUrl?: string;
  imageWidth?: number;
  imageHeight?: number;
  imageScale?: number;
  // children は削除 → yParentMap で管理
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
  groupId?: string;
  zIndex?: number;
}

export interface YjsStickyData {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  bgColor: string;
  textColor: string;
  groupId?: string;
  zIndex?: number;
}

export interface YjsOutlineData {
  type: 'rectangle' | 'circle' | 'triangle' | 'text';
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  color: string;
  groupId?: string;
  zIndex?: number;
  fontSize?: number;
}

export interface YjsStampData {
  text: string;
  color: string;
  textColor: string;
  x: number;
  y: number;
  width: number;
  height: number;
  userId: string;
  email: string;
  groupId?: string;
  zIndex?: number;
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
  groupId?: string;
  zIndex?: number;
  width?: number;
  height?: number;
  fontSize?: number;
  collapsed?: boolean;
  imageUrl?: string;
  imageWidth?: number;
  imageHeight?: number;
  imageScale?: number;
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
  groupId?: string;
  zIndex?: number;
  width?: number;
  height?: number;
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
  user_id: string;
  owner_email?: string;
  created_at: string;
  updated_at?: string;
  sort_order?: number;
  members?: MapMember[];
}

export interface AwarenessState {
  email: string;
  color: string;
  selectedNodeId: string | null;
  editingNodeId: string | null;
  cursorX?: number;
  cursorY?: number;
  mouseInCanvas?: boolean;
}

export interface Participant {
  user_id: string;
  email: string;
  color: string;
  isOnline: boolean;
  isSelf: boolean;
  selectedNodeId: string | null;
  editingNodeId: string | null;
  cursorX?: number;
  cursorY?: number;
  mouseInCanvas?: boolean;
}

export interface ContextMenuInfo {
  visible: boolean;
  x: number;
  y: number;
  type: 'node' | 'canvas' | 'edge' | 'colorPalette' | 'image' | 'sticky' | 'outline' | 'stamp';
  nodeId?: string;
  edgeId?: string;
  imageId?: string;
  stickyId?: string;
  outlineId?: string;
  stampId?: string;
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
  groupId?: string;
  zIndex?: number;
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
  groupId?: string;
  zIndex?: number;
}

export interface OutlineData {
  id: string;
  type: 'rectangle' | 'circle' | 'triangle' | 'text';
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  color: string;
  groupId?: string;
  zIndex?: number;
  fontSize?: number;
}

export interface StampData {
  id: string;
  text: string;
  color: string;
  textColor: string;
  x: number;
  y: number;
  width: number;
  height: number;
  userId: string;
  email: string;
  groupId?: string;
  zIndex?: number;
}

type ToolType = 'select' | 'rectangle' | 'circle' | 'triangle' | 'text';

const COLOR_PALETTE = [
  { bg: '#f8fafc', text: '#334155', label: 'スレート' },
  { bg: '#f1f5f9', text: '#475569', label: 'グレー' },
  { bg: '#fef2f2', text: '#be123c', label: 'ローズ' },
  { bg: '#fff7ed', text: '#c2410c', label: 'オレンジ' },
  { bg: '#fefce8', text: '#a16207', label: 'イエロー' },
  { bg: '#f0fdf4', text: '#15803d', label: 'グリーン' },
  { bg: '#f0fdfa', text: '#0f766e', label: 'ティール' },
  { bg: '#eff6ff', text: '#1d4ed8', label: 'ブルー' },
  { bg: '#eef2ff', text: '#4338ca', label: 'インディゴ' },
  { bg: '#faf5ff', text: '#7e22ce', label: 'パープル' },
];

const STAMP_RED = '#ea5550';
const DEFAULT_STICKY_WIDTH = 200;
const DEFAULT_STICKY_HEIGHT = 160;
const NODE_WIDTH = 160;
const NODE_HEIGHT = 50;
const NODE_DEFAULT_FONT_SIZE = 14;
const NODE_MIN_WIDTH = 80;
const NODE_PADDING_HORIZONTAL = 40;
const IMAGE_NODE_MAX_INITIAL_SIZE = 300;
const STAMP_DEFAULT_WIDTH = 60;
const STAMP_DEFAULT_HEIGHT = 60;
const FONT_SIZES = [10, 12, 14, 16, 18, 20, 24, 28, 32];
const IMAGE_SCALE_PRESETS = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0];

let _measureCanvas: HTMLCanvasElement | null = null;
const getMeasureCanvas = (): CanvasRenderingContext2D => {
  if (!_measureCanvas) {
    if (typeof window !== 'undefined') {
      _measureCanvas = document.createElement('canvas');
    }
  }
  const ctx = _measureCanvas?.getContext('2d');
  if (ctx) {
    ctx.font = `${NODE_DEFAULT_FONT_SIZE}px 'Inter', 'Noto Sans JP', sans-serif`;
    return ctx;
  }
  return {} as CanvasRenderingContext2D;
};

const computeNodeWidth = (text: string, fontSize: number = NODE_DEFAULT_FONT_SIZE): number => {
  if (typeof window === 'undefined') return NODE_MIN_WIDTH;
  const ctx = getMeasureCanvas();
  if (ctx.measureText) {
    ctx.font = `bold ${fontSize}px 'Inter', 'Noto Sans JP', sans-serif`;
    const metrics = ctx.measureText(text);
    return Math.max(NODE_MIN_WIDTH, metrics.width + NODE_PADDING_HORIZONTAL);
  }
  return NODE_MIN_WIDTH;
};

// ==================== 幾何学ユーティリティ ====================
const getConnectionPoint = (x: number, y: number, point: ConnectionPoint, width: number, height: number): { x: number; y: number } => {
  switch (point) {
    case 'top':    return { x, y: y - height / 2 };
    case 'right':  return { x: x + width / 2, y };
    case 'bottom': return { x, y: y + height / 2 };
    case 'left':   return { x: x - width / 2, y };
  }
};

const findClosestConnectionPoint = (nodeX: number, nodeY: number, targetX: number, targetY: number, width: number, height: number): ConnectionPoint => {
  const points: ConnectionPoint[] = ['top', 'right', 'bottom', 'left'];
  let closest: ConnectionPoint = 'top';
  let minDist = Infinity;
  for (const p of points) {
    const pt = getConnectionPoint(nodeX, nodeY, p, width, height);
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

// ==================== yParentMap を用いたツリー構築（孤児修復付き） ====================
const yMapToTree = (nodes: Y.Map<YjsNodeData>, yParentMap: Y.Map<string>, rootId: string): MindNode | null => {
  // 孤児修復：親が存在しない、または親IDが自分自身を指している場合はルートに繋ぎ変える
  yParentMap.forEach((parentId, childId) => {
    if (parentId === childId || !nodes.get(parentId)) {
      yParentMap.set(childId, rootId);
    }
  });

  const childMap = new Map<string, string[]>();
  yParentMap.forEach((parentId, childId) => {
    if (!childMap.has(parentId)) childMap.set(parentId, []);
    childMap.get(parentId)!.push(childId);
  });
  const convert = (id: string): MindNode | null => {
    const data = nodes.get(id);
    if (!data) return null;
    const childrenIds = childMap.get(id) || [];
    const children = childrenIds.map(convert).filter((c): c is MindNode => c !== null);
    const fontSize = data.fontSize ?? NODE_DEFAULT_FONT_SIZE;
    let width = data.width;
    let height = data.height;
    if (data.imageUrl && data.imageWidth && data.imageHeight) {
      const scale = data.imageScale ?? 1.0;
      width = data.imageWidth * scale;
      height = data.imageHeight * scale;
    } else if (!width && data.imageUrl) {
      width = IMAGE_NODE_MAX_INITIAL_SIZE;
      height = IMAGE_NODE_MAX_INITIAL_SIZE;
    } else if (!width) {
      width = computeNodeWidth(data.text, fontSize);
      height = NODE_HEIGHT;
    }
    return {
      id, text: data.text, x: data.x, y: data.y,
      independent: data.independent ?? false,
      bgColor: data.bgColor ?? '#f8fafc',
      textColor: data.textColor ?? '#334155',
      groupId: data.groupId,
      zIndex: data.zIndex,
      width, height,
      fontSize,
      collapsed: data.collapsed ?? false,
      imageUrl: data.imageUrl,
      imageWidth: data.imageWidth,
      imageHeight: data.imageHeight,
      imageScale: data.imageScale ?? 1.0,
      children,
    };
  };
  return convert(rootId);
};

const treeToYMap = (root: MindNode, nodes: Y.Map<YjsNodeData>, yParentMap: Y.Map<string>) => {
  nodes.set(root.id, {
    text: root.text, x: root.x, y: root.y,
    independent: root.independent ?? false,
    bgColor: root.bgColor ?? '#f8fafc',
    textColor: root.textColor ?? '#334155',
    groupId: root.groupId,
    zIndex: root.zIndex,
    width: root.width,
    height: root.height,
    fontSize: root.fontSize ?? NODE_DEFAULT_FONT_SIZE,
    collapsed: root.collapsed ?? false,
    imageUrl: root.imageUrl,
    imageWidth: root.imageWidth,
    imageHeight: root.imageHeight,
    imageScale: root.imageScale ?? 1.0,
  });
  for (const child of root.children) {
    yParentMap.set(child.id, root.id);
    treeToYMap(child, nodes, yParentMap);
  }
};

const flattenTree = (node: MindNode, parentId?: string, parentX?: number, parentY?: number): FlatNode[] => {
  const current: FlatNode = {
    id: node.id, x: node.x, y: node.y,
    parentId, parentX, parentY,
    independent: node.independent,
    bgColor: node.bgColor,
    textColor: node.textColor,
    groupId: node.groupId,
    zIndex: node.zIndex,
    width: node.width ?? NODE_WIDTH,
    height: node.height ?? NODE_HEIGHT,
  };
  if (node.collapsed) {
    return [current];
  }
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

const isNodeInRect = (node: MindNode, rect: { x1: number; y1: number; x2: number; y2: number }): boolean => {
  const w = node.width ?? NODE_WIDTH;
  const h = node.height ?? NODE_HEIGHT;
  const left = node.x - w / 2, right = node.x + w / 2, top = node.y - h / 2, bottom = node.y + h / 2;
  const rx1 = Math.min(rect.x1, rect.x2);
  const rx2 = Math.max(rect.x1, rect.x2);
  const ry1 = Math.min(rect.y1, rect.y2);
  const ry2 = Math.max(rect.y1, rect.y2);
  return !(right < rx1 || left > rx2 || bottom < ry1 || top > ry2);
};
const isImageInRect = (img: ImageData, rect: { x1: number; y1: number; x2: number; y2: number }): boolean => {
  const rx1 = Math.min(rect.x1, rect.x2), rx2 = Math.max(rect.x1, rect.x2);
  const ry1 = Math.min(rect.y1, rect.y2), ry2 = Math.max(rect.y1, rect.y2);
  return !(img.x + img.width < rx1 || img.x > rx2 || img.y + img.height < ry1 || img.y > ry2);
};
const isStickyInRect = (sticky: StickyData, rect: { x1: number; y1: number; x2: number; y2: number }): boolean => {
  const rx1 = Math.min(rect.x1, rect.x2), rx2 = Math.max(rect.x1, rect.x2);
  const ry1 = Math.min(rect.y1, rect.y2), ry2 = Math.max(rect.y1, rect.y2);
  return !(sticky.x + sticky.width < rx1 || sticky.x > rx2 || sticky.y + sticky.height < ry1 || sticky.y > ry2);
};
const isOutlineInRect = (outline: OutlineData, rect: { x1: number; y1: number; x2: number; y2: number }): boolean => {
  const rx1 = Math.min(rect.x1, rect.x2), rx2 = Math.max(rect.x1, rect.x2);
  const ry1 = Math.min(rect.y1, rect.y2), ry2 = Math.max(rect.y1, rect.y2);
  return !(outline.x + outline.width < rx1 || outline.x > rx2 || outline.y + outline.height < ry1 || outline.y > ry2);
};
const isStampInRect = (stamp: StampData, rect: { x1: number; y1: number; x2: number; y2: number }): boolean => {
  const rx1 = Math.min(rect.x1, rect.x2), rx2 = Math.max(rect.x1, rect.x2);
  const ry1 = Math.min(rect.y1, rect.y2), ry2 = Math.max(rect.y1, rect.y2);
  return !(stamp.x + stamp.width < rx1 || stamp.x > rx2 || stamp.y + stamp.height < ry1 || stamp.y > ry2);
};

const getCanvasCoords = (clientX: number, clientY: number, container: HTMLDivElement, zoomLevel: number): { x: number; y: number } => {
  const rect = container.getBoundingClientRect();
  const style = window.getComputedStyle(container);
  const padLeft = parseFloat(style.paddingLeft) || 0;
  const padTop = parseFloat(style.paddingTop) || 0;
  const borderLeft = container.clientLeft;
  const borderTop = container.clientTop;
  const x = (clientX - rect.left - borderLeft - padLeft + container.scrollLeft) / zoomLevel;
  const y = (clientY - rect.top - borderTop - padTop + container.scrollTop) / zoomLevel;
  return { x, y };
};

const findNodeAtPoint = (root: MindNode, x: number, y: number, excludeId?: string): MindNode | null => {
  if (excludeId && root.id === excludeId) return null;
  const stack: MindNode[] = [root];
  while (stack.length) {
    const node = stack.pop()!;
    const w = node.width ?? NODE_WIDTH;
    const h = node.height ?? NODE_HEIGHT;
    const left = node.x - w / 2 - 15, top = node.y - h / 2 - 15;
    if (x >= left && x <= left + w + 30 && y >= top && y <= top + h + 30 && node.id !== excludeId) return node;
    if (!node.collapsed) {
      for (const c of node.children) stack.push(c);
    }
  }
  return null;
};

const findNodeById = (root: MindNode, id: string): MindNode | null => {
  if (root.id === id) return root;
  for (const c of root.children) {
    const found = findNodeById(c, id);
    if (found) return found;
  }
  return null;
};

const getNodeDisplayPos = (nodeId: string, mindMap: MindNode | null, dragPositions: Record<string, { x: number; y: number }>, draggingNodeId: string | null): { x: number; y: number; width: number; height: number } | null => {
  if (!mindMap) return null;
  const node = findNodeById(mindMap, nodeId);
  if (!node) return null;
  let w = node.width ?? NODE_WIDTH;
  let h = node.height ?? NODE_HEIGHT;
  if (node.imageUrl && node.imageWidth && node.imageHeight && node.imageScale !== undefined) {
    w = node.imageWidth * node.imageScale;
    h = node.imageHeight * node.imageScale;
  }
  if (nodeId === draggingNodeId && dragPositions[nodeId]) return { x: dragPositions[nodeId].x, y: dragPositions[nodeId].y, width: w, height: h };
  return { x: node.x, y: node.y, width: w, height: h };
};

const uint8ArrayToBase64 = (u8: Uint8Array): string => { let binary = ''; for (let i = 0; i < u8.byteLength; i++) binary += String.fromCharCode(u8[i]); return btoa(binary); };
const base64ToUint8Array = (b64: string): Uint8Array => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
const stringToColor = (str: string): string => { let hash = 0; for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash); return `hsl(${Math.abs(hash) % 360}, 70%, 60%)`; };
const getInitial = (email: string): string => email.split('@')[0].substring(0, 2).toUpperCase();

// ==================== アイコン ====================
const UndoIcon = () => ( <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a5 5 0 015 5v2M3 10l4-4M3 10l4 4" /></svg> );
const RedoIcon = () => ( <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 10H11a5 5 0 00-5 5v2m15-7l-4-4m4 4l-4 4" /></svg> );
const PlusIcon = () => ( <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg> );
const SaveIcon = () => ( <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v11a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-4 0V4m0 3h4m-4 0H8" /></svg> );
const LinkIcon = () => ( <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 010 5.656l-2.828 2.828a4 4 0 01-5.656-5.656l2.828-2.828m6.364-6.364a4 4 0 010 5.656l-2.828 2.828a4 4 0 01-5.656-5.656l2.828-2.828" /></svg> );
const HomeIcon = () => ( <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg> );
const PaletteIcon = () => ( <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" /></svg> );
const TrashIcon = () => ( <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg> );
const LeaveIcon = () => ( <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg> );
const SubNodeIcon = () => ( <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg> );
const SiblingNodeIcon = ({ className = '' }: { className?: string }) => ( <svg className={`w-4 h-4 ${className}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" /></svg> );
const CopyIcon = () => ( <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg> );
const StickyIcon = () => ( <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg> );
const ImageIcon = () => ( <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg> );
const PencilIcon = () => ( <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg> );
const HelpIcon = () => ( <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> );
const GripVerticalIcon = () => ( <svg className="w-4 h-4 text-slate-300 cursor-move" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5v14M15 5v14" /></svg> );
const CursorIcon = () => ( <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" /></svg> );
const SquareIcon = () => ( <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2" strokeWidth={2} /></svg> );
const CircleIcon = () => ( <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" strokeWidth={2} /></svg> );
const TriangleIcon = () => ( <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><polygon points="12,4 20,20 4,20" strokeWidth={2} strokeLinejoin="round" /></svg> );
const TextOutlineIcon = () => ( <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7V4h16v3M9 20h6M12 4v16" /></svg> );
const CollapseIcon = () => ( <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg> );
const ExpandIcon = () => ( <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg> );
const ImageNodeIcon = () => ( <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="2" strokeWidth={2} /><circle cx="8.5" cy="8.5" r="2.5" strokeWidth={2} /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 15l-5-5-6 6-3-3-5 5" /></svg> );
const ResizeIcon = () => ( <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16M8 4v16M16 4v16" /></svg> );
const CloseIcon = () => ( <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg> );
const StampIcon = () => ( <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2zm0 0v14M12 7v10M7 12h10" /></svg> );
const GridIcon = () => ( <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" strokeWidth={2} /><line x1="3" y1="9" x2="21" y2="9" strokeWidth={2} /><line x1="3" y1="15" x2="21" y2="15" strokeWidth={2} /><line x1="9" y1="3" x2="9" y2="21" strokeWidth={2} /><line x1="15" y1="3" x2="15" y2="21" strokeWidth={2} /></svg> );

// ==================== 認証画面 ====================
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

// ==================== メイン ====================
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

// ==================== 共同編集マインドマップ ====================
const MindMapApp = ({ user }: { user: User }) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageFileInputRef = useRef<HTMLInputElement>(null);
  const [mapId, setMapId] = useState<number | null>(null);
  const [mapTitle, setMapTitle] = useState('NEW');
  const [roomId, setRoomId] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState('');
  const [savedMaps, setSavedMaps] = useState<MapRecord[]>([]);
  const [mapMembers, setMapMembers] = useState<MapMember[]>([]);
  const [mapOwnerId, setMapOwnerId] = useState<string | null>(null);
  const [initialLoadDone, setInitialLoadDone] = useState(false);

  const [editingMapId, setEditingMapId] = useState<number | null>(null);
  const [editMapTitle, setEditMapTitle] = useState('');
  
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [currentTool, setCurrentTool] = useState<ToolType>('select');
  const [edgeStyle, setEdgeStyle] = useState<EdgeStyle>('bezier');

  const ydocRef = useRef<Y.Doc | null>(null);
  const yNodesRef = useRef<Y.Map<YjsNodeData> | null>(null);
  const yEdgesRef = useRef<Y.Map<YjsEdgeData> | null>(null);
  const yImagesRef = useRef<Y.Map<YjsImageData> | null>(null);
  const yStickiesRef = useRef<Y.Map<YjsStickyData> | null>(null);
  const yOutlinesRef = useRef<Y.Map<YjsOutlineData> | null>(null);
  const ySettingsRef = useRef<Y.Map<string> | null>(null);
  const yStampsRef = useRef<Y.Map<YjsStampData> | null>(null);
  const yRootRef = useRef<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const undoManagerRef = useRef<Y.UndoManager | null>(null);
  const yParentMapRef = useRef<Y.Map<string> | null>(null); // ★ 親子マップ

  const [mindMap, setMindMap] = useState<MindNode | null>(null);
  const [edges, setEdges] = useState<EdgeData[]>([]);
  const [images, setImages] = useState<ImageData[]>([]);
  const [stickies, setStickies] = useState<StickyData[]>([]);
  const [outlines, setOutlines] = useState<OutlineData[]>([]);
  const [stamps, setStamps] = useState<StampData[]>([]);

  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedImageIds, setSelectedImageIds] = useState<string[]>([]);
  const [selectedStickyIds, setSelectedStickyIds] = useState<string[]>([]);
  const [selectedOutlineIds, setSelectedOutlineIds] = useState<string[]>([]);
  const [selectedStampIds, setSelectedStampIds] = useState<string[]>([]);

  const selectedNodeId = selectedNodeIds.length === 1 ? selectedNodeIds[0] : null;
  const selectedImageId = selectedImageIds.length === 1 ? selectedImageIds[0] : null;
  const selectedStickyId = selectedStickyIds.length === 1 ? selectedStickyIds[0] : null;
  const selectedOutlineId = selectedOutlineIds.length === 1 ? selectedOutlineIds[0] : null;
  const selectedStampId = selectedStampIds.length === 1 ? selectedStampIds[0] : null;

  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  const [dragPositions, setDragPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [dragTargetNodeId, setDragTargetNodeId] = useState<string | null>(null);
  
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [editingEdgeEndpoint, setEditingEdgeEndpoint] = useState<{ edgeId: string; endpoint: 'source' | 'target' } | null>(null);
  const [drawingEdge, setDrawingEdge] = useState<{ sourceNodeId: string; sourcePoint: ConnectionPoint; currentX: number; currentY: number; targetNodeId?: string; targetPoint?: ConnectionPoint } | null>(null);

  const [showColorPalette, setShowColorPalette] = useState<{ nodeId?: string; stickyId?: string; outlineId?: string; stampId?: string; x: number; y: number } | null>(null);
  
  const [draggingImageId, setDraggingImageId] = useState<string | null>(null);
  const [draggingStickyId, setDraggingStickyId] = useState<string | null>(null);
  const [draggingOutlineId, setDraggingOutlineId] = useState<string | null>(null);
  const [draggingStampId, setDraggingStampId] = useState<string | null>(null);

  const [resizingImageHandle, setResizingImageHandle] = useState<{ imageId: string; handle: string } | null>(null);
  const [resizingStickyHandle, setResizingStickyHandle] = useState<{ stickyId: string; handle: string } | null>(null);
  const [resizingOutlineHandle, setResizingOutlineHandle] = useState<{ outlineId: string; handle: string } | null>(null);

  const [editingStickyId, setEditingStickyId] = useState<string | null>(null);
  const [editingOutlineId, setEditingOutlineId] = useState<string | null>(null);
  
  const imageDragOffset = useRef({ x: 0, y: 0 });
  const stickyDragOffset = useRef({ x: 0, y: 0 });
  const outlineDragOffset = useRef({ x: 0, y: 0 });
  const stampDragOffset = useRef({ x: 0, y: 0 });

  const [selectionRect, setSelectionRect] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const wasDraggingRef = useRef(false);

  const groupDragStartMouse = useRef({ x: 0, y: 0 });
  const initialGroupDragPositions = useRef<Record<string, { x: number; y: number }>>({});
  const initialGroupImagePositions = useRef<Record<string, { x: number; y: number }>>({});
  const initialGroupStickyPositions = useRef<Record<string, { x: number; y: number }>>({});
  const initialGroupOutlinePositions = useRef<Record<string, { x: number; y: number }>>({});
  const initialGroupStampPositions = useRef<Record<string, { x: number; y: number }>>({});
  
  const [multiDragOffsets, setMultiDragOffsets] = useState<{dx: number, dy: number} | null>(null);
  const isMultiDragging = multiDragOffsets !== null;

  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [isCanvasPanning, setIsCanvasPanning] = useState(false);
  const panStartCoords = useRef({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });

  const [showGrid, setShowGrid] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('mindmap-show-grid');
      return saved !== null ? saved === 'true' : true;
    }
    return true;
  });

  const toggleGrid = useCallback(() => {
    setShowGrid(prev => {
      const next = !prev;
      if (typeof window !== 'undefined') localStorage.setItem('mindmap-show-grid', String(next));
      return next;
    });
  }, []);

  const addLog = (msg: string) => { if (import.meta.env.DEV) console.log(`[MindMap] ${msg}`); };
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
  const [inviteLink, setInviteLink] = useState('');

  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [imageModalUrl, setImageModalUrl] = useState<string | null>(null);

  const [stampText, setStampText] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('mindmap-stamp-text');
      if (saved) return saved;
    }
    const name = myEmail.split('@')[0];
    return name.length > 8 ? name.substring(0, 8) : name;
  });

  useEffect(() => {
    if (typeof window !== 'undefined') localStorage.setItem('mindmap-stamp-text', stampText);
  }, [stampText]);

  const cursorBroadcastTimerRef = useRef<number | null>(null);
  const lastMindMapRef = useRef<MindNode | null>(null);

  const isAnyDragging = useMemo(() => {
    return draggingNodeId !== null || editingEdgeEndpoint !== null || drawingEdge !== null || 
           draggingImageId !== null || draggingStickyId !== null || draggingOutlineId !== null || draggingStampId !== null ||
           resizingImageHandle !== null || resizingStickyHandle !== null || resizingOutlineHandle !== null || 
           selectionRect !== null || isCanvasPanning || isMultiDragging;
  }, [draggingNodeId, editingEdgeEndpoint, drawingEdge, draggingImageId, draggingStickyId, draggingOutlineId, draggingStampId, resizingImageHandle, resizingStickyHandle, resizingOutlineHandle, selectionRect, isCanvasPanning, isMultiDragging]);

  const getMaxZIndex = useCallback(() => {
    let max = 10;
    yNodesRef.current?.forEach(v => { if (v.zIndex && v.zIndex > max) max = v.zIndex; });
    yImagesRef.current?.forEach(v => { if (v.zIndex && v.zIndex > max) max = v.zIndex; });
    yStickiesRef.current?.forEach(v => { if (v.zIndex && v.zIndex > max) max = v.zIndex; });
    yOutlinesRef.current?.forEach(v => { if (v.zIndex && v.zIndex > max) max = v.zIndex; });
    yStampsRef.current?.forEach(v => { if (v.zIndex && v.zIndex > max) max = v.zIndex; });
    return max;
  }, []);
  const getMinZIndex = useCallback(() => {
    let min = 4;
    yNodesRef.current?.forEach(v => { if (v.zIndex && v.zIndex < min) min = v.zIndex; });
    yImagesRef.current?.forEach(v => { if (v.zIndex && v.zIndex < min) min = v.zIndex; });
    yStickiesRef.current?.forEach(v => { if (v.zIndex && v.zIndex < min) min = v.zIndex; });
    yOutlinesRef.current?.forEach(v => { if (v.zIndex && v.zIndex < min) min = v.zIndex; });
    yStampsRef.current?.forEach(v => { if (v.zIndex && v.zIndex < min) min = v.zIndex; });
    return min;
  }, []);

  const bringToFront = useCallback(() => {
    const newZ = getMaxZIndex() + 1;
    ydocRef.current?.transact(() => {
      selectedNodeIds.forEach(id => { const n = yNodesRef.current?.get(id); if (n) yNodesRef.current?.set(id, { ...n, zIndex: newZ }); });
      selectedImageIds.forEach(id => { const n = yImagesRef.current?.get(id); if (n) yImagesRef.current?.set(id, { ...n, zIndex: newZ }); });
      selectedStickyIds.forEach(id => { const n = yStickiesRef.current?.get(id); if (n) yStickiesRef.current?.set(id, { ...n, zIndex: newZ }); });
      selectedOutlineIds.forEach(id => { const n = yOutlinesRef.current?.get(id); if (n) yOutlinesRef.current?.set(id, { ...n, zIndex: newZ }); });
      selectedStampIds.forEach(id => { const n = yStampsRef.current?.get(id); if (n) yStampsRef.current?.set(id, { ...n, zIndex: newZ }); });
    });
  }, [selectedNodeIds, selectedImageIds, selectedStickyIds, selectedOutlineIds, selectedStampIds, getMaxZIndex]);
  const sendToBack = useCallback(() => {
    const newZ = getMinZIndex() - 1;
    ydocRef.current?.transact(() => {
      selectedNodeIds.forEach(id => { const n = yNodesRef.current?.get(id); if (n) yNodesRef.current?.set(id, { ...n, zIndex: newZ }); });
      selectedImageIds.forEach(id => { const n = yImagesRef.current?.get(id); if (n) yImagesRef.current?.set(id, { ...n, zIndex: newZ }); });
      selectedStickyIds.forEach(id => { const n = yStickiesRef.current?.get(id); if (n) yStickiesRef.current?.set(id, { ...n, zIndex: newZ }); });
      selectedOutlineIds.forEach(id => { const n = yOutlinesRef.current?.get(id); if (n) yOutlinesRef.current?.set(id, { ...n, zIndex: newZ }); });
      selectedStampIds.forEach(id => { const n = yStampsRef.current?.get(id); if (n) yStampsRef.current?.set(id, { ...n, zIndex: newZ }); });
    });
  }, [selectedNodeIds, selectedImageIds, selectedStickyIds, selectedOutlineIds, selectedStampIds, getMinZIndex]);

  const totalSelectedCount = selectedNodeIds.length + selectedImageIds.length + selectedStickyIds.length + selectedOutlineIds.length + selectedStampIds.length;

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

  // ==================== ノード操作 (yParentMap 完全対応) ====================
  const addChildNode = useCallback((parentId: string) => {
    const nodes = yNodesRef.current;
    const parentMap = yParentMapRef.current;
    if (!nodes || !parentMap || !ydocRef.current) return;
    const parent = nodes.get(parentId);
    if (!parent) return;
    const childId = crypto.randomUUID();
    const safePos = getUnoccupiedPosition(parent.x + NODE_WIDTH + 40, parent.y, nodes);
    const defaultText = '新しいトピック';
    const defaultFontSize = NODE_DEFAULT_FONT_SIZE;
    const initialWidth = computeNodeWidth(defaultText, defaultFontSize);
    ydocRef.current.transact(() => {
      nodes.set(childId, { text: defaultText, x: safePos.x, y: safePos.y, independent: false, bgColor: '#f8fafc', textColor: '#334155', width: initialWidth, height: NODE_HEIGHT, fontSize: defaultFontSize, collapsed: false });
      parentMap.set(childId, parentId);
    });
    setSelectedNodeIds([childId]);
  }, []);

  const deleteNode = useCallback((nodeId: string) => {
    const nodes = yNodesRef.current;
    const parentMap = yParentMapRef.current;
    if (!nodes || !parentMap || !yRootRef.current || nodeId === yRootRef.current) return;
    ydocRef.current?.transact(() => {
      const deleteRecursive = (id: string) => {
        nodes.delete(id);
        parentMap.delete(id);
        parentMap.forEach((pid, cid) => {
          if (pid === id) deleteRecursive(cid);
        });
      };
      deleteRecursive(nodeId);
    });
    setSelectedNodeIds(prev => prev.filter(id => id !== nodeId));
  }, []);

  const addSiblingNode = useCallback((targetId: string, position: 'before' | 'after') => {
    const nodes = yNodesRef.current;
    const parentMap = yParentMapRef.current;
    if (!nodes || !parentMap || !yRootRef.current || targetId === yRootRef.current) return;
    const parentId = parentMap.get(targetId);
    if (!parentId) return;
    const parent = nodes.get(parentId);
    if (!parent) return;
    const siblingId = crypto.randomUUID();
    const targetNode = nodes.get(targetId);
    const safePos = getUnoccupiedPosition(targetNode ? targetNode.x : parent.x + NODE_WIDTH + 40, targetNode ? targetNode.y + (position === 'after' ? (NODE_HEIGHT + 20) : -(NODE_HEIGHT + 20)) : parent.y, nodes);
    const defaultText = '新しいトピック';
    const defaultFontSize = NODE_DEFAULT_FONT_SIZE;
    const initialWidth = computeNodeWidth(defaultText, defaultFontSize);
    ydocRef.current?.transact(() => {
      nodes.set(siblingId, { text: defaultText, x: safePos.x, y: safePos.y, independent: false, bgColor: '#f8fafc', textColor: '#334155', width: initialWidth, height: NODE_HEIGHT, fontSize: defaultFontSize, collapsed: false });
      parentMap.set(siblingId, parentId);
    });
    setSelectedNodeIds([siblingId]);
  }, []);

  const addIndependentSibling = useCallback((targetId: string, position: 'before' | 'after') => {
    const nodes = yNodesRef.current;
    const parentMap = yParentMapRef.current;
    if (!nodes || !parentMap || !yRootRef.current) return;
    const targetNode = nodes.get(targetId);
    if (!targetNode) return;
    const newId = crypto.randomUUID();
    const offsetY = position === 'after' ? (NODE_HEIGHT + 20) : -(NODE_HEIGHT + 20);
    const safePos = getUnoccupiedPosition(targetNode.x, targetNode.y + offsetY, nodes);
    const rootId = yRootRef.current;
    const defaultText = '独立トピック';
    const defaultFontSize = NODE_DEFAULT_FONT_SIZE;
    const initialWidth = computeNodeWidth(defaultText, defaultFontSize);
    ydocRef.current?.transact(() => {
      nodes.set(newId, { text: defaultText, x: safePos.x, y: safePos.y, independent: true, bgColor: '#f8fafc', textColor: '#334155', width: initialWidth, height: NODE_HEIGHT, fontSize: defaultFontSize, collapsed: false });
      parentMap.set(newId, rootId);
    });
    setSelectedNodeIds([newId]);
  }, []);

  const addParentNode = useCallback((targetId: string) => {
    const nodes = yNodesRef.current;
    const parentMap = yParentMapRef.current;
    if (!nodes || !parentMap || !yRootRef.current || targetId === yRootRef.current) return;
    const oldParentId = parentMap.get(targetId);
    if (!oldParentId) return;
    const oldParent = nodes.get(oldParentId);
    if (!oldParent) return;
    const targetNode = nodes.get(targetId);
    if (!targetNode) return;
    const newParentId = crypto.randomUUID();
    const safePos = getUnoccupiedPosition(targetNode.x - NODE_WIDTH - 40, targetNode.y, nodes);
    const defaultText = '新しいトピック';
    const defaultFontSize = NODE_DEFAULT_FONT_SIZE;
    const initialWidth = computeNodeWidth(defaultText, defaultFontSize);
    ydocRef.current?.transact(() => {
      nodes.set(newParentId, { text: defaultText, x: safePos.x, y: safePos.y, independent: false, bgColor: '#f8fafc', textColor: '#334155', width: initialWidth, height: NODE_HEIGHT, fontSize: defaultFontSize, collapsed: false });
      parentMap.set(newParentId, oldParentId);
      parentMap.set(targetId, newParentId);
    });
    setSelectedNodeIds([newParentId]);
  }, []);

  const reparentNode = useCallback((nodeId: string, newParentId: string) => {
    const parentMap = yParentMapRef.current;
    if (!parentMap || !yRootRef.current || nodeId === yRootRef.current) return;
    const oldParentId = parentMap.get(nodeId);
    if (!oldParentId || oldParentId === newParentId) return;
    ydocRef.current?.transact(() => {
      parentMap.set(nodeId, newParentId);
    });
  }, []);

  const addNodeAtPosition = useCallback((x: number, y: number, isImageNode: boolean = false, imageUrl?: string, imageWidth?: number, imageHeight?: number) => {
    const nodes = yNodesRef.current;
    const parentMap = yParentMapRef.current;
    const rootId = yRootRef.current;
    if (!nodes || !parentMap || !rootId) return;
    const childId = crypto.randomUUID();
    const safePos = getUnoccupiedPosition(x, y, nodes);
    if (isImageNode && imageUrl && imageWidth && imageHeight) {
      ydocRef.current?.transact(() => {
        nodes.set(childId, {
          text: '', x: safePos.x, y: safePos.y, independent: true,
          bgColor: '#f8fafc', textColor: '#334155',
          width: imageWidth, height: imageHeight,
          collapsed: false,
          imageUrl, imageWidth, imageHeight, imageScale: 1.0
        });
        parentMap.set(childId, rootId);
      });
    } else {
      const defaultText = '独立トピック';
      const defaultFontSize = NODE_DEFAULT_FONT_SIZE;
      const initialWidth = computeNodeWidth(defaultText, defaultFontSize);
      ydocRef.current?.transact(() => {
        nodes.set(childId, {
          text: defaultText, x: safePos.x, y: safePos.y, independent: true,
          bgColor: '#f8fafc', textColor: '#334155',
          width: initialWidth, height: NODE_HEIGHT, fontSize: defaultFontSize,
          collapsed: false
        });
        parentMap.set(childId, rootId);
      });
    }
    setSelectedNodeIds([childId]);
  }, []);

  const addSticky = useCallback((x: number, y: number) => {
    const yStickies = yStickiesRef.current; if (!yStickies || !ydocRef.current) return;
    const id = crypto.randomUUID();
    ydocRef.current.transact(() => {
      yStickies.set(id, { x, y, width: DEFAULT_STICKY_WIDTH, height: DEFAULT_STICKY_HEIGHT, text: '', bgColor: '#fefce8', textColor: '#a16207' });
    });
    setSelectedStickyIds([id]);
    setSelectedNodeIds([]); setSelectedImageIds([]); setSelectedOutlineIds([]); setSelectedStampIds([]);
  }, []);

  const addOutline = useCallback((type: 'rectangle' | 'circle' | 'triangle' | 'text', x: number, y: number) => {
    const yOutlines = yOutlinesRef.current; if (!yOutlines || !ydocRef.current) return;
    const id = crypto.randomUUID();
    const width = type === 'text' ? 150 : 100;
    const height = type === 'text' ? 50 : 100;
    ydocRef.current.transact(() => {
      yOutlines.set(id, { type, x, y, width, height, text: type === 'text' ? 'テキスト' : '', color: '#475569', fontSize: NODE_DEFAULT_FONT_SIZE });
    });
    setSelectedOutlineIds([id]);
    setSelectedNodeIds([]); setSelectedImageIds([]); setSelectedStickyIds([]); setSelectedStampIds([]);
    if (type === 'text') setEditingOutlineId(id);
  }, []);

  const addStamp = useCallback((x: number, y: number) => {
    const yStamps = yStampsRef.current; if (!yStamps || !ydocRef.current) return;
    const id = crypto.randomUUID();
    ydocRef.current.transact(() => {
      yStamps.set(id, {
        text: stampText,
        color: STAMP_RED,
        textColor: STAMP_RED,
        x, y,
        width: STAMP_DEFAULT_WIDTH,
        height: STAMP_DEFAULT_HEIGHT,
        userId: myUserId,
        email: myEmail,
      });
    });
    setSelectedNodeIds([]); setSelectedImageIds([]); setSelectedStickyIds([]); setSelectedOutlineIds([]);
    setSelectedStampIds([id]);
  }, [stampText, myUserId, myEmail]);

  const deleteSticky = useCallback((stickyId: string) => { const yStickies = yStickiesRef.current; if (!yStickies) return; ydocRef.current?.transact(() => { yStickies.delete(stickyId); }); setSelectedStickyIds(prev => prev.filter(id => id !== stickyId)); }, []);
  const deleteOutline = useCallback((outlineId: string) => { const yOutlines = yOutlinesRef.current; if (!yOutlines) return; ydocRef.current?.transact(() => { yOutlines.delete(outlineId); }); setSelectedOutlineIds(prev => prev.filter(id => id !== outlineId)); }, []);
  const deleteStamp = useCallback((stampId: string) => { const yStamps = yStampsRef.current; if (!yStamps) return; ydocRef.current?.transact(() => { yStamps.delete(stampId); }); setSelectedStampIds(prev => prev.filter(id => id !== stampId)); }, []);
  const deleteImage = useCallback((imageId: string) => { const yImages = yImagesRef.current; if (!yImages) return; const image = yImages.get(imageId); if (image) { supabase.storage.from('images').remove([image.storagePath]); } ydocRef.current?.transact(() => { yImages.delete(imageId); }); setSelectedImageIds(prev => prev.filter(id => id !== imageId)); closeContextMenu(); }, [closeContextMenu]);

  const updateText = useCallback((nodeId: string, text: string) => { const nodes = yNodesRef.current; if (!nodes) return; const data = nodes.get(nodeId); if (data) nodes.set(nodeId, { ...data, text }); }, []);
  const updatePosition = useCallback((nodeId: string, x: number, y: number) => { const nodes = yNodesRef.current; if (!nodes) return; const data = nodes.get(nodeId); if (data) nodes.set(nodeId, { ...data, x, y }); }, []);
  const updateNodeColors = useCallback((nodeId: string, bgColor: string, textColor: string) => { const nodes = yNodesRef.current; if (!nodes) return; const data = nodes.get(nodeId); if (data) nodes.set(nodeId, { ...data, bgColor, textColor }); }, []);
  const updateMultipleNodeColors = useCallback((nodeIds: string[], bgColor: string, textColor: string) => { const nodes = yNodesRef.current; if (!nodes) return; ydocRef.current?.transact(() => { nodeIds.forEach(id => { const data = nodes.get(id); if (data) nodes.set(id, { ...data, bgColor, textColor }); }); }); }, []);
  const updateNodeFontSize = useCallback((nodeId: string, fontSize: number) => { const nodes = yNodesRef.current; if (!nodes) return; const data = nodes.get(nodeId); if (data && !data.imageUrl) { const newWidth = computeNodeWidth(data.text, fontSize); nodes.set(nodeId, { ...data, fontSize, width: newWidth }); } }, []);
  const updateNodeWidth = useCallback((nodeId: string, width: number) => { const nodes = yNodesRef.current; if (!nodes) return; const data = nodes.get(nodeId); if (data) nodes.set(nodeId, { ...data, width }); }, []);
  const toggleNodeCollapse = useCallback((nodeId: string) => { if (nodeId === yRootRef.current) return; const nodes = yNodesRef.current; if (!nodes) return; const data = nodes.get(nodeId); if (data) { ydocRef.current?.transact(() => { nodes.set(nodeId, { ...data, collapsed: !data.collapsed }); }); } }, []);
  const resizeImageNode = useCallback((nodeId: string, scale: number) => { const nodes = yNodesRef.current; if (!nodes) return; const data = nodes.get(nodeId); if (data && data.imageUrl && data.imageWidth && data.imageHeight) { ydocRef.current?.transact(() => { const newWidth = data.imageWidth! * scale; const newHeight = data.imageHeight! * scale; nodes.set(nodeId, { ...data, imageScale: scale, width: newWidth, height: newHeight }); }); } }, []);
  const updateStickyColors = useCallback((stickyId: string, bgColor: string, textColor: string) => { const yStickies = yStickiesRef.current; if (!yStickies) return; const data = yStickies.get(stickyId); if (data) yStickies.set(stickyId, { ...data, bgColor, textColor }); }, []);
  const updateStickyText = useCallback((stickyId: string, text: string) => { const yStickies = yStickiesRef.current; if (!yStickies) return; const data = yStickies.get(stickyId); if (data) yStickies.set(stickyId, { ...data, text }); }, []);
  const updateStickyPosition = useCallback((stickyId: string, x: number, y: number) => { const yStickies = yStickiesRef.current; if (!yStickies) return; const data = yStickies.get(stickyId); if (data) yStickies.set(stickyId, { ...data, x, y }); }, []);
  const updateStickySize = useCallback((stickyId: string, width: number, height: number) => { const yStickies = yStickiesRef.current; if (!yStickies) return; const data = yStickies.get(stickyId); if (data) yStickies.set(stickyId, { ...data, width, height }); }, []);
  const updateOutlineColor = useCallback((outlineId: string, color: string) => { const yOutlines = yOutlinesRef.current; if (!yOutlines) return; const data = yOutlines.get(outlineId); if (data) yOutlines.set(outlineId, { ...data, color }); }, []);
  const updateOutlineText = useCallback((outlineId: string, text: string) => { const yOutlines = yOutlinesRef.current; if (!yOutlines) return; const data = yOutlines.get(outlineId); if (data) yOutlines.set(outlineId, { ...data, text }); }, []);
  const updateOutlinePosition = useCallback((outlineId: string, x: number, y: number) => { const yOutlines = yOutlinesRef.current; if (!yOutlines) return; const data = yOutlines.get(outlineId); if (data) yOutlines.set(outlineId, { ...data, x, y }); }, []);
  const updateOutlineSize = useCallback((outlineId: string, width: number, height: number) => { const yOutlines = yOutlinesRef.current; if (!yOutlines) return; const data = yOutlines.get(outlineId); if (data) yOutlines.set(outlineId, { ...data, width, height }); }, []);
  const updateOutlineFontSize = useCallback((outlineId: string, fontSize: number) => { const yOutlines = yOutlinesRef.current; if (!yOutlines) return; const data = yOutlines.get(outlineId); if (data && data.type === 'text') { ydocRef.current?.transact(() => { yOutlines.set(outlineId, { ...data, fontSize }); }); } }, []);
  const updateImagePosition = useCallback((imageId: string, x: number, y: number) => { const yImages = yImagesRef.current; if (!yImages) return; const data = yImages.get(imageId); if (data) yImages.set(imageId, { ...data, x, y }); }, []);
  const updateStampPosition = useCallback((stampId: string, x: number, y: number) => { const yStamps = yStampsRef.current; if (!yStamps) return; const data = yStamps.get(stampId); if (data) yStamps.set(stampId, { ...data, x, y }); }, []);

  const addEdge = useCallback((sourceNodeId: string, sourcePoint: ConnectionPoint, targetNodeId: string, targetPoint: ConnectionPoint) => { const yEdges = yEdgesRef.current; if (!yEdges || !ydocRef.current) return; const edgeId = crypto.randomUUID(); ydocRef.current.transact(() => { yEdges.set(edgeId, { sourceNodeId, sourcePoint, targetNodeId, targetPoint, arrow: 'none' }); }); }, []);
  const deleteEdge = useCallback((edgeId: string) => {
    if (edgeId.startsWith('parent-edge-')) {
      const childId = edgeId.replace('parent-edge-', '');
      const nodes = yNodesRef.current;
      const parentMap = yParentMapRef.current;
      const rootId = yRootRef.current;
      if (!nodes || !parentMap || !rootId) return;
      ydocRef.current?.transact(() => {
        const parentId = parentMap.get(childId);
        if (parentId && parentId !== rootId) {
          parentMap.set(childId, rootId);
          const nodeData = nodes.get(childId);
          if (nodeData) nodes.set(childId, { ...nodeData, independent: true });
        }
      });
      setSelectedEdgeId(null); closeContextMenu(); return;
    }
    const yEdges = yEdgesRef.current; if (!yEdges) return; ydocRef.current?.transact(() => { yEdges.delete(edgeId); }); setSelectedEdgeId(null); closeContextMenu();
  }, [closeContextMenu]);
  const updateEdgeEndpoint = useCallback((edgeId: string, endpoint: 'source' | 'target', point: ConnectionPoint) => { const yEdges = yEdgesRef.current; if (!yEdges) return; const edge = yEdges.get(edgeId); if (!edge) return; ydocRef.current?.transact(() => { if (endpoint === 'source') yEdges.set(edgeId, { ...edge, sourcePoint: point }); else yEdges.set(edgeId, { ...edge, targetPoint: point }); }); }, []);
  const updateEdgeArrow = useCallback((edgeId: string, arrow: 'none' | 'start' | 'end' | 'both') => { const yEdges = yEdgesRef.current; if (!yEdges) return; const edge = yEdges.get(edgeId); if (!edge) return; ydocRef.current?.transact(() => { yEdges.set(edgeId, { ...edge, arrow }); }); }, []);

  const handleHeaderAddSticky = useCallback(() => { const container = scrollContainerRef.current; if (!container) return; const x = (container.scrollLeft + container.clientWidth / 2) / zoomLevel; const y = (container.scrollTop + container.clientHeight / 2) / zoomLevel; addSticky(x, y); }, [addSticky, zoomLevel]);
  const handleHeaderColorSelect = useCallback((bgColor: string, textColor: string) => {
    if (selectedNodeIds.length > 0) updateMultipleNodeColors(selectedNodeIds, bgColor, textColor);
    if (selectedStickyIds.length > 0) selectedStickyIds.forEach(id => updateStickyColors(id, bgColor, textColor));
    if (selectedOutlineIds.length > 0) selectedOutlineIds.forEach(id => updateOutlineColor(id, textColor));
  }, [selectedNodeIds, selectedStickyIds, selectedOutlineIds, updateMultipleNodeColors, updateStickyColors, updateOutlineColor]);
  const handleEdgeStyleChange = useCallback((newStyle: EdgeStyle) => { if (!ydocRef.current) return; const settings = ySettingsRef.current; if (settings) { ydocRef.current.transact(() => { settings.set('edgeStyle', newStyle); }); } setEdgeStyle(newStyle); }, []);
  const alignNodes = useCallback((axis: 'vertical' | 'horizontal') => { const nodes = yNodesRef.current; if (!nodes || selectedNodeIds.length < 2) return; const refNodeId = selectedNodeIds[0]; const refNode = nodes.get(refNodeId); if (!refNode) return; const targetX = axis === 'vertical' ? refNode.x : undefined; const targetY = axis === 'horizontal' ? refNode.y : undefined; const idsToAlign = selectedNodeIds.slice(1); ydocRef.current?.transact(() => { idsToAlign.forEach(id => { const data = nodes.get(id); if (!data) return; const updated = { ...data }; if (targetX !== undefined) updated.x = targetX; if (targetY !== undefined) updated.y = targetY; nodes.set(id, updated); }); }); }, [selectedNodeIds]);

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
      if (w > MAX_DIM || h > MAX_DIM) { const ratio = Math.min(MAX_DIM / w, MAX_DIM / h); w = Math.round(w * ratio); h = Math.round(h * ratio); }
      const yImages = yImagesRef.current; if (!yImages || !ydocRef.current) return;
      const imageId = crypto.randomUUID();
      const container = scrollContainerRef.current;
      const centerX = container ? container.scrollLeft + container.clientWidth / 2 : 5000;
      const centerY = container ? container.scrollTop + container.clientHeight / 2 : 5000;
      ydocRef.current.transact(() => { yImages.set(imageId, { storagePath: path, x: centerX - w / 2, y: centerY - h / 2, width: w, height: h }); });
    };
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const addImageNodeWithUpload = useCallback(async (x: number, y: number) => {
    if (!imageFileInputRef.current) return;
    imageFileInputRef.current.onchange = async (e: Event) => {
      const target = e.target as HTMLInputElement;
      const file = target.files?.[0]; if (!file) return;
      const fileExt = file.name.split('.').pop(); const fileName = `${crypto.randomUUID()}.${fileExt}`;
      const { data, error } = await supabase.storage.from('images').upload(fileName, file);
      if (error) { alert('画像のアップロードに失敗しました'); return; }
      const publicUrl = supabase.storage.from('images').getPublicUrl(data.path).data.publicUrl;
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        const maxDim = IMAGE_NODE_MAX_INITIAL_SIZE;
        if (w > maxDim || h > maxDim) { const ratio = Math.min(maxDim / w, maxDim / h); w = Math.round(w * ratio); h = Math.round(h * ratio); }
        addNodeAtPosition(x, y, true, publicUrl, w, h);
      };
      img.src = publicUrl;
      target.value = '';
    };
    imageFileInputRef.current.click();
  }, [addNodeAtPosition]);

  const fetchMaps = useCallback(async () => {
    const { data: ownMaps, error: ownError } = await supabase.from('maps').select('*').order('sort_order', { ascending: true }).order('created_at', { ascending: false });
    if (ownError) { console.error('マップ一覧の取得に失敗しました:', ownError); return; }
    const { data: memberMaps, error: memberError } = await supabase.from('map_members').select('map_id').eq('user_id', user.id);
    if (memberError) { console.error('共有マップの取得に失敗しました:', memberError); return; }
    const sharedMapIds = (memberMaps || []).map(m => m.map_id);
    let sharedMaps: MapRecord[] = [];
    if (sharedMapIds.length > 0) {
      const { data: sharedData, error: sharedError } = await supabase.from('maps').select('*').in('id', sharedMapIds).order('sort_order', { ascending: true }).order('created_at', { ascending: false });
      if (sharedError) { console.error('共有マップ詳細の取得に失敗しました:', sharedError); return; }
      sharedMaps = (sharedData || []) as MapRecord[];
    }
    const allMaps = [...(ownMaps || [])] as MapRecord[];
    for (const sm of sharedMaps) { if (!allMaps.find(m => m.id === sm.id)) allMaps.push(sm); }
    setSavedMaps(allMaps);
  }, [user.id]);

  const fetchMapMembers = useCallback(async () => {
    if (!mapId) { setMapMembers([]); return; }
    const { data, error } = await supabase.from('map_members').select('user_id, email').eq('map_id', mapId);
    if (error) { console.error('メンバー取得エラー:', error); return; }
    setMapMembers(data || []);
  }, [mapId]);

  useEffect(() => { fetchMaps(); }, [fetchMaps]);
  useEffect(() => { fetchMapMembers(); }, [fetchMapMembers, mapId]);

  const canShare = useMemo(() => {
    if (!mapId) return false;
    if (mapOwnerId === user.id) return true;
    return mapMembers.some(m => m.user_id === user.id);
  }, [mapId, mapOwnerId, user.id, mapMembers]);

  useEffect(() => {
    if (!ydocRef.current || !yNodesRef.current || !yParentMapRef.current || !yRootRef.current || !roomId) return;
    const autoSave = async () => {
      const tree = yMapToTree(yNodesRef.current!, yParentMapRef.current!, yRootRef.current!);
      if (!tree) return;
      try {
        if (mapId) {
          const { error } = await supabase.from('maps').update({ data: tree, updated_at: new Date().toISOString() }).eq('id', mapId);
          if (!error) { setIsDirty(false); if (roomId) localStorage.setItem(`mindmap-draft-${roomId}`, uint8ArrayToBase64(Y.encodeStateAsUpdate(ydocRef.current!))); }
        } else if (roomId) {
          const { data, error } = await supabase.from('maps').insert({ title: mapTitle, data: tree, room_id: roomId, user_id: user.id, owner_email: user.email, updated_at: new Date().toISOString() }).select();
          if (!error && data && data[0]) { setMapId(data[0].id); setMapOwnerId(data[0].user_id); setIsDirty(false); localStorage.setItem(`mindmap-draft-${roomId}`, uint8ArrayToBase64(Y.encodeStateAsUpdate(ydocRef.current!))); }
        }
      } catch (err) { console.error('自動保存エラー:', err); }
    };
    const handleUpdate = () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current); autoSaveTimerRef.current = setTimeout(autoSave, 500); };
    const doc = ydocRef.current;
    doc.on('update', handleUpdate);
    return () => { doc.off('update', handleUpdate); if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current); };
  }, [mapId, mapTitle, roomId, user.id, user.email]);

  // ==================== initYjs ====================
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
    const yOutlines = ydoc.getMap<YjsOutlineData>('outlines'); yOutlinesRef.current = yOutlines;
    const ySettings = ydoc.getMap<string>('settings'); ySettingsRef.current = ySettings;
    const yStamps = ydoc.getMap<YjsStampData>('stamps'); yStampsRef.current = yStamps;
    const yParentMap = ydoc.getMap<string>('parentMap'); yParentMapRef.current = yParentMap;
    
    ydoc.transact(() => {
      if (initialTree) { 
        treeToYMap(initialTree, yNodes, yParentMap); 
        yRootRef.current = initialTree.id; 
      } else { 
        const rootId = crypto.randomUUID(); 
        const defaultText = '中心テーマ';
        const defaultFontSize = NODE_DEFAULT_FONT_SIZE;
        const initialWidth = computeNodeWidth(defaultText, defaultFontSize);
        yNodes.set(rootId, { text: defaultText, x: 5000, y: 5000, independent: false, bgColor: '#f8fafc', textColor: '#334155', width: initialWidth, height: NODE_HEIGHT, fontSize: defaultFontSize, collapsed: false }); 
        yRootRef.current = rootId; 
      }
    });

    const updateReact = () => {
      if (yRootRef.current) {
        const rootData = yNodes.get(yRootRef.current);
        if (!rootData) {
          const lastRoot = lastMindMapRef.current;
          ydoc.transact(() => {
            if (lastRoot) {
              yNodes.set(yRootRef.current!, {
                text: lastRoot.text, x: lastRoot.x, y: lastRoot.y,
                independent: false,
                bgColor: lastRoot.bgColor ?? '#f8fafc',
                textColor: lastRoot.textColor ?? '#334155',
                width: lastRoot.width,
                height: lastRoot.height,
                fontSize: lastRoot.fontSize ?? NODE_DEFAULT_FONT_SIZE,
                collapsed: false,
                imageUrl: lastRoot.imageUrl, imageWidth: lastRoot.imageWidth, imageHeight: lastRoot.imageHeight, imageScale: lastRoot.imageScale ?? 1.0,
              });
            } else {
              yNodes.set(yRootRef.current!, { text: '中心テーマ', x: 5000, y: 5000, independent: false, bgColor: '#f8fafc', textColor: '#334155', width: computeNodeWidth('中心テーマ', NODE_DEFAULT_FONT_SIZE), height: NODE_HEIGHT, fontSize: NODE_DEFAULT_FONT_SIZE, collapsed: false });
            }
          });
          return;
        }
        const tree = yMapToTree(yNodes, yParentMap, yRootRef.current);
        if (tree) { setMindMap(tree); lastMindMapRef.current = tree; }
        else if (lastMindMapRef.current) setMindMap(lastMindMapRef.current);
      }
      const edgeList: EdgeData[] = []; yEdges.forEach((value, key) => edgeList.push({ id: key, sourceNodeId: value.sourceNodeId, sourcePoint: value.sourcePoint, targetNodeId: value.targetNodeId, targetPoint: value.targetPoint, arrow: value.arrow ?? 'none' })); setEdges(edgeList);
      const imageList: ImageData[] = []; yImages.forEach((value, key) => imageList.push({ id: key, storagePath: value.storagePath, x: value.x, y: value.y, width: value.width, height: value.height, groupId: value.groupId, zIndex: value.zIndex })); setImages(imageList);
      const stickyList: StickyData[] = []; yStickies.forEach((value, key) => stickyList.push({ id: key, ...value })); setStickies(stickyList);
      const outlineList: OutlineData[] = []; yOutlines.forEach((value, key) => outlineList.push({ id: key, ...value, fontSize: value.fontSize ?? NODE_DEFAULT_FONT_SIZE })); setOutlines(outlineList);
      const stampList: StampData[] = []; yStamps.forEach((value, key) => stampList.push({ id: key, ...value })); setStamps(stampList);
      const currentStyle = ySettings.get('edgeStyle') as EdgeStyle | undefined; if (currentStyle) setEdgeStyle(currentStyle);
    };
    
    yNodes.observe(updateReact); yParentMap.observe(updateReact); yEdges.observe(updateReact); yImages.observe(updateReact); yStickies.observe(updateReact); yOutlines.observe(updateReact); ySettings.observe(updateReact); yStamps.observe(updateReact); updateReact();
    
    const undoManager = new Y.UndoManager([yNodes, yParentMap, yEdges, yImages, yStickies, yOutlines, ySettings, yStamps]);
    undoManagerRef.current = undoManager;
    const updateUndoRedoState = () => { setCanUndo(undoManager.undoStack.length > 0); setCanRedo(undoManager.redoStack.length > 0); };
    undoManager.on('stack-item-added', updateUndoRedoState); undoManager.on('stack-item-popped', updateUndoRedoState); updateUndoRedoState();
    
    const channel = supabase.channel(`map-${room}`, { config: { broadcast: { ack: false } } });
    ydoc.on('update', (update, origin) => {
      if(typeof window !== 'undefined') { try { localStorage.setItem(`mindmap-draft-${room}`, uint8ArrayToBase64(Y.encodeStateAsUpdate(ydoc))); } catch(e) {} }
      setIsDirty(true); if (origin === 'supabase' || origin === 'local') return;
      channel.send({ type: 'broadcast', event: 'yjs-update', payload: { update: uint8ArrayToBase64(update) } });
    });
    
    if(typeof window !== 'undefined') { try { const draft = localStorage.getItem(`mindmap-draft-${room}`); if (draft) { Y.applyUpdate(ydoc, base64ToUint8Array(draft), 'local'); addLog('未保存のバックアップを復元'); setIsDirty(true); } } catch(e) {} }
    
    channel.on('broadcast', { event: 'yjs-update' }, (msg) => { const update = base64ToUint8Array(msg.payload.update); Y.applyUpdate(ydoc, update, 'supabase'); });
    channel.on('broadcast', { event: 'sync-step-1' }, (msg) => { const stateVector = base64ToUint8Array(msg.payload.stateVector); const update = Y.encodeStateAsUpdate(ydoc, stateVector); if (update.byteLength > 10) channel.send({ type: 'broadcast', event: 'sync-step-2', payload: { update: uint8ArrayToBase64(update) } }); });
    channel.on('broadcast', { event: 'sync-step-2' }, (msg) => { Y.applyUpdate(ydoc, base64ToUint8Array(msg.payload.update), 'supabase'); addLog('差分同期完了'); });
    channel.on('broadcast', { event: 'awareness-update' }, (msg) => { const { userId, state } = msg.payload; if (userId === myUserId) return; if (state === null) setAwarenessStates(prev => { const { [userId]: _, ...rest } = prev; return rest; }); else setAwarenessStates(prev => ({ ...prev, [userId]: state })); });
    
    const removeSelf = () => channel.send({ type: 'broadcast', event: 'awareness-update', payload: { userId: myUserId, state: null } }); 
    if(typeof window !== 'undefined') window.addEventListener('beforeunload', removeSelf);
    
    channel.subscribe((status, err) => {
      if (status === 'SUBSCRIBED') setConnectionStatus('接続済み'); else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') setConnectionStatus('切断'); else if (status === 'TIMED_OUT') setConnectionStatus('タイムアウト'); else setConnectionStatus('接続中...');
      if (err) console.error('Supabase Error:', err);
      if (status === 'SUBSCRIBED') { channel.send({ type: 'broadcast', event: 'sync-step-1', payload: { stateVector: uint8ArrayToBase64(Y.encodeStateVector(ydoc)) } }); broadcastAwareness(channel, myUserId, { email: myEmail, color: myColor, selectedNodeId: selectedNodeIds[0] || null, editingNodeId }); }
    });
    
    channelRef.current = channel; setRoomId(room); return channel;
  };

  const inviteAcceptedRef = useRef(false);
  useEffect(() => {
    const processInvite = async () => {
      if (inviteAcceptedRef.current || !user) return;
      const urlParams = new URLSearchParams(window.location.search);
      const inviteCode = urlParams.get('invite');
      if (!inviteCode) return;
      inviteAcceptedRef.current = true;

      try {
        const { data: invitation, error } = await supabase
          .from('map_invitations')
          .select('*, maps:maps!inner(id, title, room_id, data, user_id, owner_email, updated_at)')
          .eq('invite_code', inviteCode)
          .single();
        if (error || !invitation) {
          alert('招待が無効か、既に削除されています。');
          return;
        }
        if (invitation.email.toLowerCase() !== user.email?.toLowerCase()) {
          alert('この招待は別のメールアドレス宛です。');
          return;
        }
        const { error: memberError } = await supabase.from('map_members').upsert({
          map_id: invitation.map_id,
          user_id: user.id,
          role: 'editor',
          email: user.email
        }, { onConflict: 'map_id,user_id' });
        if (memberError) throw memberError;
        await supabase.from('map_invitations').delete().eq('id', invitation.id);
        window.history.replaceState(null, '', window.location.pathname);
        handleLoadMap(invitation.maps);
      } catch (err) {
        console.error('招待の受け入れに失敗しました:', err);
        alert('招待の受け入れに失敗しました。');
      }
    };
    processInvite();
  }, [user]);

  useEffect(() => {
    let isMounted = true;
    const init = async () => {
      if (initialLoadDone) return;
      setInitialLoadDone(true);

      const urlParams = new URLSearchParams(window.location.search);
      const inviteCode = urlParams.get('invite');
      if (inviteCode) return;

      const rawHash = typeof window !== 'undefined' ? window.location.hash.slice(1) : '';
      const hash = rawHash.includes('error=') ? '' : rawHash;

      if (hash) {
        const { data, error } = await supabase.from('maps').select('*').eq('room_id', hash).single();
        if (!isMounted) return;
        if (error || !data) {
          handleNewMap();
        } else {
          setMapId(data.id);
          setMapTitle(data.title);
          setMapOwnerId(data.user_id);
          initYjs(hash, data.data as MindNode);
        }
      }
    };
    init();
    return () => { isMounted = false; };
  }, []);

  const initialScrollDone = useRef(false);
  useEffect(() => { if (mindMap && !initialScrollDone.current) { requestAnimationFrame(() => { scrollToHome(); initialScrollDone.current = true; }); } }, [mindMap, scrollToHome]);
  
  // カーソル位置ブロードキャスト
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || !channelRef.current) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (cursorBroadcastTimerRef.current) return;
      cursorBroadcastTimerRef.current = window.setTimeout(() => {
        cursorBroadcastTimerRef.current = null;
        const coords = getCanvasCoords(e.clientX, e.clientY, container, zoomLevel);
        broadcastAwareness(channelRef.current!, myUserId, {
          email: myEmail,
          color: myColor,
          selectedNodeId: selectedNodeIds[0] || null,
          editingNodeId,
          cursorX: coords.x,
          cursorY: coords.y,
          mouseInCanvas: true
        });
      }, 50);
    };

    const handleMouseLeave = () => {
      broadcastAwareness(channelRef.current!, myUserId, {
        email: myEmail,
        color: myColor,
        selectedNodeId: selectedNodeIds[0] || null,
        editingNodeId,
        mouseInCanvas: false
      });
    };

    container.addEventListener('mousemove', handleMouseMove);
    container.addEventListener('mouseleave', handleMouseLeave);
    return () => {
      container.removeEventListener('mousemove', handleMouseMove);
      container.removeEventListener('mouseleave', handleMouseLeave);
      if (cursorBroadcastTimerRef.current) clearTimeout(cursorBroadcastTimerRef.current);
    };
  }, [myUserId, myEmail, myColor, selectedNodeIds, editingNodeId, broadcastAwareness, zoomLevel]);

  useEffect(() => { if (!channelRef.current || !roomId) return; broadcastAwareness(channelRef.current, myUserId, { email: myEmail, color: myColor, selectedNodeId: selectedNodeIds[0] || null, editingNodeId }); }, [selectedNodeIds, editingNodeId, myUserId, myEmail, myColor, roomId, broadcastAwareness]);

  // ==================== 保存/その他 ====================
  const handleSave = useCallback(async () => {
    if (!yNodesRef.current || !yRootRef.current || !yParentMapRef.current || !roomId) {
      alert('保存に必要なデータが不足しています');
      return;
    }
    const tree = yMapToTree(yNodesRef.current, yParentMapRef.current, yRootRef.current);
    if (!tree) { alert('マップデータの変換に失敗しました'); return; }
    setSaveMessage('保存中...');
    try {
      let resultData;
      if (mapId) {
        const { data, error } = await supabase.from('maps').update({ title: mapTitle, data: tree, updated_at: new Date().toISOString() }).eq('id', mapId).select();
        resultData = data; if (error) throw error;
      } else {
        const { data, error } = await supabase.from('maps').insert([{ title: mapTitle, data: tree, room_id: roomId, user_id: user.id, owner_email: user.email, updated_at: new Date().toISOString() }]).select();
        resultData = data; if (error) throw error;
      }
      if (resultData && resultData.length > 0) {
        setMapId(resultData[0].id); setMapOwnerId(resultData[0].user_id);
        setSaveMessage('保存完了'); setIsDirty(false);
        if(typeof window !== 'undefined') { try { localStorage.setItem(`mindmap-draft-${roomId}`, uint8ArrayToBase64(Y.encodeStateAsUpdate(ydocRef.current!))); } catch(e) {} }
        setTimeout(() => setSaveMessage(''), 2500);
        await fetchMaps();
      }
    } catch (err: any) {
      alert(`保存エラー: ${err.message}`);
      setSaveMessage(`保存に失敗: ${err.message}`);
    }
  }, [mapId, mapTitle, roomId, user.id, user.email, fetchMaps]);

  const handleSaveTitleOnly = useCallback(async (id: number, newTitle: string) => {
    if (!newTitle.trim()) { setEditingMapId(null); return; }
    const { error } = await supabase.from('maps').update({ title: newTitle.trim() }).eq('id', id);
    if (error) { alert(`タイトルの更新に失敗しました: ${error.message}`); }
    else { if (mapId === id) setMapTitle(newTitle.trim()); await fetchMaps(); }
    setEditingMapId(null);
  }, [mapId, fetchMaps]);

  const handleHeaderTitleBlur = useCallback(() => {
    if (mapId && mapTitle.trim()) { handleSaveTitleOnly(mapId, mapTitle); }
  }, [mapId, mapTitle, handleSaveTitleOnly]);

  const handleResetMap = useCallback(() => {
    if (channelRef.current) supabase.removeChannel(channelRef.current);
    if(typeof window !== 'undefined') window.history.replaceState(null, '', ' ');
    setMapId(null); setMapTitle('NEW'); setMapMembers([]); setMapOwnerId(null);
    setMindMap(null); setEdges([]); setImages([]); setStickies([]); setOutlines([]); setStamps([]);
    setSelectedNodeIds([]); setSelectedImageIds([]); setSelectedStickyIds([]); setSelectedOutlineIds([]); setSelectedStampIds([]);
  }, []);

  const handleNewMap = useCallback(async () => {
    if (channelRef.current) supabase.removeChannel(channelRef.current);
    const newRoom = crypto.randomUUID();
    if(typeof window !== 'undefined') window.history.replaceState(null, '', `#${newRoom}`);
    const newTitle = 'NEW';
    const rootId = crypto.randomUUID();
    const defaultText = '中心テーマ';
    const defaultFontSize = NODE_DEFAULT_FONT_SIZE;
    const initialWidth = computeNodeWidth(defaultText, defaultFontSize);
    const initialTree: MindNode = { id: rootId, text: defaultText, x: 5000, y: 5000, children: [], independent: false, bgColor: '#f8fafc', textColor: '#334155', width: initialWidth, height: NODE_HEIGHT, fontSize: defaultFontSize, collapsed: false };
    initYjs(newRoom, initialTree);
    setMapId(null); setMapTitle(newTitle); setMapMembers([]); setMapOwnerId(user.id);
    setSaveMessage('保存中...');
    const { data, error } = await supabase.from('maps').insert([{ title: newTitle, data: initialTree, room_id: newRoom, user_id: user.id, owner_email: user.email, updated_at: new Date().toISOString() }]).select();
    if (error) { alert(`新規作成エラー: ${error.message}`); setSaveMessage(`作成に失敗: ${error.message}`); return; }
    if (data && data.length > 0) {
      setMapId(data[0].id); setMapOwnerId(data[0].user_id);
      setSaveMessage('保存完了'); setIsDirty(false);
      setTimeout(() => setSaveMessage(''), 2500);
      await fetchMaps();
    }
  }, [user.id, user.email, fetchMaps]);

  const handleUndo = useCallback(() => { if (undoManagerRef.current) undoManagerRef.current.undo(); }, []);
  const handleRedo = useCallback(() => { if (undoManagerRef.current) undoManagerRef.current.redo(); }, []);
  const handleLogout = useCallback(async () => { 
    if (channelRef.current) { broadcastAwareness(channelRef.current, myUserId, null); supabase.removeChannel(channelRef.current); } 
    ydocRef.current?.destroy(); if (undoManagerRef.current) undoManagerRef.current.destroy(); 
    await supabase.auth.signOut(); 
  }, [broadcastAwareness, myUserId]);

  const handleLoadMap = useCallback((map: MapRecord) => {
    if (channelRef.current) supabase.removeChannel(channelRef.current);
    if(typeof window !== 'undefined') window.location.hash = map.room_id;
    setMapId(map.id); setMapTitle(map.title); setMapOwnerId(map.user_id);
    initYjs(map.room_id, map.data);
  }, []);

  const handleCopyMap = useCallback(async (map: MapRecord, e: ReactMouseEvent) => {
    e.stopPropagation();
    const newRoom = crypto.randomUUID();
    const { error: insertError } = await supabase.from('maps').insert({
      title: `${map.title} のコピー`,
      data: map.data,
      room_id: newRoom,
      user_id: user.id,
      owner_email: user.email,
      updated_at: new Date().toISOString()
    });
    if (insertError) { alert('コピーに失敗しました'); return; }
    await fetchMaps();
  }, [user.id, user.email, fetchMaps]);

  const handleDeleteMap = useCallback(async (map: MapRecord, e: ReactMouseEvent) => {
    e.stopPropagation();
    if (map.user_id !== user.id) {
      alert('エラー：共有マップは削除できません。退出機能を利用してください。');
      return;
    }
    if (typeof window !== 'undefined' && !window.confirm('マップを削除してもよろしいですか？')) return;
    const { error } = await supabase.from('maps').delete().eq('id', map.id);
    if (error) { alert('削除に失敗しました'); return; }
    if (mapId === map.id) handleResetMap();
    await fetchMaps();
  }, [mapId, handleResetMap, fetchMaps, user.id]);

  const handleLeaveMap = useCallback(async (map: MapRecord, e: ReactMouseEvent) => {
    e.stopPropagation();
    if (typeof window !== 'undefined' && !window.confirm(`「${map.title}」から退出しますか？`)) return;
    const { error, count } = await supabase.from('map_members').delete({ count: 'exact' }).eq('map_id', map.id).eq('user_id', user.id);
    if (error) { alert(`退出に失敗しました: ${error.message}`); return; }
    if (count === 0) { alert('退出対象が見つかりませんでした。既に退出済みの可能性があります。'); return; }
    if (mapId === map.id) handleResetMap();
    await fetchMaps();
    alert('マップから退出しました');
  }, [mapId, handleResetMap, fetchMaps, user.id]);

  const dragMapItemIndex = useRef<number | null>(null);
  const dragOverMapItemIndex = useRef<number | null>(null);

  const handleMapDragStart = useCallback((e: DragEvent<HTMLDivElement>, index: number) => {
    dragMapItemIndex.current = index;
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
  }, []);

  const handleMapDragEnter = useCallback((_e: DragEvent<HTMLDivElement>, index: number) => {
    dragOverMapItemIndex.current = index;
  }, []);

  const handleMapDragEnd = useCallback(async () => {
    if (dragMapItemIndex.current !== null && dragOverMapItemIndex.current !== null && dragMapItemIndex.current !== dragOverMapItemIndex.current) {
      const newSavedMaps = [...savedMaps];
      const draggedItem = newSavedMaps.splice(dragMapItemIndex.current, 1)[0];
      newSavedMaps.splice(dragOverMapItemIndex.current, 0, draggedItem);
      setSavedMaps(newSavedMaps);
      try { await Promise.all(newSavedMaps.map((map, index) => supabase.from('maps').update({ sort_order: index }).eq('id', map.id))); } catch (err) { console.error('並び替え保存エラー', err); }
    }
    dragMapItemIndex.current = null; dragOverMapItemIndex.current = null;
  }, [savedMaps]);

  const handleShare = useCallback(() => { if (!roomId) return; setShowInviteModal(true); setInviteLink(''); setInviteMessage(''); }, [roomId]);
  const handleInviteSubmit = useCallback(async () => {
    if (!inviteEmail.trim() || !mapId) { if (!mapId) setInviteMessage('マップを保存してから招待してください'); return; }
    setInviteLoading(true); setInviteMessage(''); setInviteLink('');
    try {
      const { data, error } = await supabase.rpc('create_invitation', { p_map_id: mapId, p_email: inviteEmail.trim() });
      if (error) throw error;
      if (data.status === 'added') { setInviteMessage('招待しました！'); setInviteEmail(''); await fetchMapMembers(); }
      else if (data.status === 'invited') { const link = `${window.location.origin}?invite=${data.invite_code}`; setInviteLink(link); setInviteMessage('招待リンクを生成しました。以下のリンクを共有してください。'); }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setInviteMessage('エラーが発生しました: ' + errorMessage);
    } finally { setInviteLoading(false); }
  }, [inviteEmail, mapId, fetchMapMembers]);

  // ==================== マウスイベントハンドラ（変更なし）====================
  const handleMouseDownOnNode = useCallback((e: ReactMouseEvent, nodeId: string) => {
    if (e.button !== 0 || isSpacePressed) return; e.stopPropagation();
    const container = scrollContainerRef.current; if (!container) return;
    const coords = getCanvasCoords(e.clientX, e.clientY, container, zoomLevel);
    const node = mindMap ? findNodeById(mindMap, nodeId) : null; if (!node) return;
    const targetGroupId = node.groupId;
    let isMulti = false;
    const newSelectedNodeIds = new Set<string>(); const newSelectedImageIds = new Set<string>(); const newSelectedStickyIds = new Set<string>(); const newSelectedOutlineIds = new Set<string>(); const newSelectedStampIds = new Set<string>();
    if (e.ctrlKey || e.metaKey) {
      isMulti = true;
      selectedNodeIds.forEach(id => newSelectedNodeIds.add(id)); selectedImageIds.forEach(id => newSelectedImageIds.add(id)); selectedStickyIds.forEach(id => newSelectedStickyIds.add(id)); selectedOutlineIds.forEach(id => newSelectedOutlineIds.add(id)); selectedStampIds.forEach(id => newSelectedStampIds.add(id));
      if (newSelectedNodeIds.has(nodeId)) newSelectedNodeIds.delete(nodeId); else newSelectedNodeIds.add(nodeId);
      setSelectedNodeIds(Array.from(newSelectedNodeIds));
    } else {
      if (selectedNodeIds.includes(nodeId) && (selectedNodeIds.length > 1 || selectedImageIds.length > 0 || selectedStickyIds.length > 0 || selectedOutlineIds.length > 0 || selectedStampIds.length > 0)) {
        isMulti = true;
        selectedNodeIds.forEach(id => newSelectedNodeIds.add(id)); selectedImageIds.forEach(id => newSelectedImageIds.add(id)); selectedStickyIds.forEach(id => newSelectedStickyIds.add(id)); selectedOutlineIds.forEach(id => newSelectedOutlineIds.add(id)); selectedStampIds.forEach(id => newSelectedStampIds.add(id));
      } else if (targetGroupId) {
        isMulti = true;
        yNodesRef.current?.forEach((v, k) => { if(v.groupId === targetGroupId) newSelectedNodeIds.add(k); });
        yImagesRef.current?.forEach((v, k) => { if(v.groupId === targetGroupId) newSelectedImageIds.add(k); });
        yStickiesRef.current?.forEach((v, k) => { if(v.groupId === targetGroupId) newSelectedStickyIds.add(k); });
        yOutlinesRef.current?.forEach((v, k) => { if(v.groupId === targetGroupId) newSelectedOutlineIds.add(k); });
        yStampsRef.current?.forEach((v, k) => { if(v.groupId === targetGroupId) newSelectedStampIds.add(k); });
        setSelectedNodeIds(Array.from(newSelectedNodeIds)); setSelectedImageIds(Array.from(newSelectedImageIds)); setSelectedStickyIds(Array.from(newSelectedStickyIds)); setSelectedOutlineIds(Array.from(newSelectedOutlineIds)); setSelectedStampIds(Array.from(newSelectedStampIds));
      } else {
        newSelectedNodeIds.add(nodeId); setSelectedNodeIds([nodeId]); setSelectedImageIds([]); setSelectedStickyIds([]); setSelectedOutlineIds([]); setSelectedStampIds([]);
      }
    }
    if (isMulti) {
      groupDragStartMouse.current = { x: coords.x, y: coords.y };
      const initNodePos: Record<string, { x: number; y: number }> = {};
      newSelectedNodeIds.forEach(id => { const n = mindMap ? findNodeById(mindMap, id) : null; if (n) initNodePos[id] = { x: n.x, y: n.y }; });
      initialGroupDragPositions.current = initNodePos;
      setMultiDragOffsets({ dx: 0, dy: 0 }); setDraggingNodeId(null); setDragTargetNodeId(null); setSelectedEdgeId(null);
    } else {
      dragOffset.current = { x: coords.x - node.x, y: coords.y - node.y };
      setDragPositions(prev => ({ ...prev, [nodeId]: { x: node.x, y: node.y } }));
      setDraggingNodeId(nodeId); setDragTargetNodeId(null); setSelectedEdgeId(null);
      setMultiDragOffsets(null);
    }
  }, [mindMap, zoomLevel, selectedNodeIds, selectedImageIds, selectedStickyIds, selectedOutlineIds, selectedStampIds, isSpacePressed]);

  const handleMouseDownOnImage = useCallback((e: ReactMouseEvent, imageId: string) => {
    if (e.button !== 0 || isSpacePressed) return; e.stopPropagation();
    const image = images.find((img: ImageData) => img.id === imageId); if (!image) return;
    const container = scrollContainerRef.current; if (!container) return;
    const coords = getCanvasCoords(e.clientX, e.clientY, container, zoomLevel);
    const targetGroupId = yImagesRef.current?.get(imageId)?.groupId;
    let isMulti = false;
    const newSelectedNodeIds = new Set<string>(); const newSelectedImageIds = new Set<string>(); const newSelectedStickyIds = new Set<string>(); const newSelectedOutlineIds = new Set<string>(); const newSelectedStampIds = new Set<string>();
    if (e.ctrlKey || e.metaKey) {
      isMulti = true;
      selectedNodeIds.forEach(id => newSelectedNodeIds.add(id)); selectedImageIds.forEach(id => newSelectedImageIds.add(id)); selectedStickyIds.forEach(id => newSelectedStickyIds.add(id)); selectedOutlineIds.forEach(id => newSelectedOutlineIds.add(id)); selectedStampIds.forEach(id => newSelectedStampIds.add(id));
      if (newSelectedImageIds.has(imageId)) newSelectedImageIds.delete(imageId); else newSelectedImageIds.add(imageId);
      setSelectedImageIds(Array.from(newSelectedImageIds));
    } else {
      if (selectedImageIds.includes(imageId) && (selectedNodeIds.length > 0 || selectedImageIds.length > 1 || selectedStickyIds.length > 0 || selectedOutlineIds.length > 0 || selectedStampIds.length > 0)) {
        isMulti = true;
        selectedNodeIds.forEach(id => newSelectedNodeIds.add(id)); selectedImageIds.forEach(id => newSelectedImageIds.add(id)); selectedStickyIds.forEach(id => newSelectedStickyIds.add(id)); selectedOutlineIds.forEach(id => newSelectedOutlineIds.add(id)); selectedStampIds.forEach(id => newSelectedStampIds.add(id));
      } else if (targetGroupId) {
        isMulti = true;
        yNodesRef.current?.forEach((v, k) => { if(v.groupId === targetGroupId) newSelectedNodeIds.add(k); });
        yImagesRef.current?.forEach((v, k) => { if(v.groupId === targetGroupId) newSelectedImageIds.add(k); });
        yStickiesRef.current?.forEach((v, k) => { if(v.groupId === targetGroupId) newSelectedStickyIds.add(k); });
        yOutlinesRef.current?.forEach((v, k) => { if(v.groupId === targetGroupId) newSelectedOutlineIds.add(k); });
        yStampsRef.current?.forEach((v, k) => { if(v.groupId === targetGroupId) newSelectedStampIds.add(k); });
        setSelectedNodeIds(Array.from(newSelectedNodeIds)); setSelectedImageIds(Array.from(newSelectedImageIds)); setSelectedStickyIds(Array.from(newSelectedStickyIds)); setSelectedOutlineIds(Array.from(newSelectedOutlineIds)); setSelectedStampIds(Array.from(newSelectedStampIds));
      } else {
        newSelectedImageIds.add(imageId); setSelectedImageIds([imageId]); setSelectedNodeIds([]); setSelectedStickyIds([]); setSelectedOutlineIds([]); setSelectedStampIds([]);
      }
    }
    if (isMulti) {
      groupDragStartMouse.current = { x: coords.x, y: coords.y };
      const initImgPos: Record<string, { x: number; y: number }> = {};
      newSelectedImageIds.forEach(id => { const i = images.find(img=>img.id===id); if (i) initImgPos[id] = { x: i.x, y: i.y }; });
      initialGroupImagePositions.current = initImgPos;
      setMultiDragOffsets({ dx: 0, dy: 0 }); setDraggingImageId(null); setSelectedEdgeId(null);
    } else {
      imageDragOffset.current = { x: coords.x - image.x, y: coords.y - image.y };
      setDraggingImageId(imageId); setSelectedEdgeId(null); setMultiDragOffsets(null);
    }
  }, [images, zoomLevel, isSpacePressed, selectedNodeIds, selectedImageIds, selectedStickyIds, selectedOutlineIds, selectedStampIds]);

  const handleMouseDownOnSticky = useCallback((e: ReactMouseEvent, stickyId: string) => {
    if (e.button !== 0 || isSpacePressed) return; e.stopPropagation();
    const sticky = stickies.find((s: StickyData) => s.id === stickyId); if (!sticky) return;
    const container = scrollContainerRef.current; if (!container) return;
    const coords = getCanvasCoords(e.clientX, e.clientY, container, zoomLevel);
    const targetGroupId = yStickiesRef.current?.get(stickyId)?.groupId;
    let isMulti = false;
    const newSelectedNodeIds = new Set<string>(); const newSelectedImageIds = new Set<string>(); const newSelectedStickyIds = new Set<string>(); const newSelectedOutlineIds = new Set<string>(); const newSelectedStampIds = new Set<string>();
    if (e.ctrlKey || e.metaKey) {
      isMulti = true;
      selectedNodeIds.forEach(id => newSelectedNodeIds.add(id)); selectedImageIds.forEach(id => newSelectedImageIds.add(id)); selectedStickyIds.forEach(id => newSelectedStickyIds.add(id)); selectedOutlineIds.forEach(id => newSelectedOutlineIds.add(id)); selectedStampIds.forEach(id => newSelectedStampIds.add(id));
      if (newSelectedStickyIds.has(stickyId)) newSelectedStickyIds.delete(stickyId); else newSelectedStickyIds.add(stickyId);
      setSelectedStickyIds(Array.from(newSelectedStickyIds));
    } else {
      if (selectedStickyIds.includes(stickyId) && (selectedNodeIds.length > 0 || selectedImageIds.length > 0 || selectedStickyIds.length > 1 || selectedOutlineIds.length > 0 || selectedStampIds.length > 0)) {
        isMulti = true;
        selectedNodeIds.forEach(id => newSelectedNodeIds.add(id)); selectedImageIds.forEach(id => newSelectedImageIds.add(id)); selectedStickyIds.forEach(id => newSelectedStickyIds.add(id)); selectedOutlineIds.forEach(id => newSelectedOutlineIds.add(id)); selectedStampIds.forEach(id => newSelectedStampIds.add(id));
      } else if (targetGroupId) {
        isMulti = true;
        yNodesRef.current?.forEach((v, k) => { if(v.groupId === targetGroupId) newSelectedNodeIds.add(k); });
        yImagesRef.current?.forEach((v, k) => { if(v.groupId === targetGroupId) newSelectedImageIds.add(k); });
        yStickiesRef.current?.forEach((v, k) => { if(v.groupId === targetGroupId) newSelectedStickyIds.add(k); });
        yOutlinesRef.current?.forEach((v, k) => { if(v.groupId === targetGroupId) newSelectedOutlineIds.add(k); });
        yStampsRef.current?.forEach((v, k) => { if(v.groupId === targetGroupId) newSelectedStampIds.add(k); });
        setSelectedNodeIds(Array.from(newSelectedNodeIds)); setSelectedImageIds(Array.from(newSelectedImageIds)); setSelectedStickyIds(Array.from(newSelectedStickyIds)); setSelectedOutlineIds(Array.from(newSelectedOutlineIds)); setSelectedStampIds(Array.from(newSelectedStampIds));
      } else {
        newSelectedStickyIds.add(stickyId); setSelectedStickyIds([stickyId]); setSelectedNodeIds([]); setSelectedImageIds([]); setSelectedOutlineIds([]); setSelectedStampIds([]);
      }
    }
    if (isMulti) {
      groupDragStartMouse.current = { x: coords.x, y: coords.y };
      const initStickyPos: Record<string, { x: number; y: number }> = {};
      newSelectedStickyIds.forEach(id => { const s = stickies.find(st=>st.id===id); if (s) initStickyPos[id] = { x: s.x, y: s.y }; });
      initialGroupStickyPositions.current = initStickyPos;
      setMultiDragOffsets({ dx: 0, dy: 0 }); setDraggingStickyId(null); setSelectedEdgeId(null);
    } else {
      stickyDragOffset.current = { x: coords.x - sticky.x, y: coords.y - sticky.y };
      setDraggingStickyId(stickyId); setSelectedEdgeId(null); setMultiDragOffsets(null);
    }
  }, [stickies, zoomLevel, isSpacePressed, selectedNodeIds, selectedImageIds, selectedStickyIds, selectedOutlineIds, selectedStampIds]);

  const handleMouseDownOnOutline = useCallback((e: ReactMouseEvent, outlineId: string) => {
    if (e.button !== 0 || isSpacePressed) return; e.stopPropagation();
    const outline = outlines.find((o: OutlineData) => o.id === outlineId); if (!outline) return;
    const container = scrollContainerRef.current; if (!container) return;
    const coords = getCanvasCoords(e.clientX, e.clientY, container, zoomLevel);
    const targetGroupId = yOutlinesRef.current?.get(outlineId)?.groupId;
    let isMulti = false;
    const newSelectedNodeIds = new Set<string>(); const newSelectedImageIds = new Set<string>(); const newSelectedStickyIds = new Set<string>(); const newSelectedOutlineIds = new Set<string>(); const newSelectedStampIds = new Set<string>();
    if (e.ctrlKey || e.metaKey) {
      isMulti = true;
      selectedNodeIds.forEach(id => newSelectedNodeIds.add(id)); selectedImageIds.forEach(id => newSelectedImageIds.add(id)); selectedStickyIds.forEach(id => newSelectedStickyIds.add(id)); selectedOutlineIds.forEach(id => newSelectedOutlineIds.add(id)); selectedStampIds.forEach(id => newSelectedStampIds.add(id));
      if (newSelectedOutlineIds.has(outlineId)) newSelectedOutlineIds.delete(outlineId); else newSelectedOutlineIds.add(outlineId);
      setSelectedOutlineIds(Array.from(newSelectedOutlineIds));
    } else {
      if (selectedOutlineIds.includes(outlineId) && (selectedNodeIds.length > 0 || selectedImageIds.length > 0 || selectedStickyIds.length > 0 || selectedOutlineIds.length > 1 || selectedStampIds.length > 0)) {
        isMulti = true;
        selectedNodeIds.forEach(id => newSelectedNodeIds.add(id)); selectedImageIds.forEach(id => newSelectedImageIds.add(id)); selectedStickyIds.forEach(id => newSelectedStickyIds.add(id)); selectedOutlineIds.forEach(id => newSelectedOutlineIds.add(id)); selectedStampIds.forEach(id => newSelectedStampIds.add(id));
      } else if (targetGroupId) {
        isMulti = true;
        yNodesRef.current?.forEach((v, k) => { if(v.groupId === targetGroupId) newSelectedNodeIds.add(k); });
        yImagesRef.current?.forEach((v, k) => { if(v.groupId === targetGroupId) newSelectedImageIds.add(k); });
        yStickiesRef.current?.forEach((v, k) => { if(v.groupId === targetGroupId) newSelectedStickyIds.add(k); });
        yOutlinesRef.current?.forEach((v, k) => { if(v.groupId === targetGroupId) newSelectedOutlineIds.add(k); });
        yStampsRef.current?.forEach((v, k) => { if(v.groupId === targetGroupId) newSelectedStampIds.add(k); });
        setSelectedNodeIds(Array.from(newSelectedNodeIds)); setSelectedImageIds(Array.from(newSelectedImageIds)); setSelectedStickyIds(Array.from(newSelectedStickyIds)); setSelectedOutlineIds(Array.from(newSelectedOutlineIds)); setSelectedStampIds(Array.from(newSelectedStampIds));
      } else {
        newSelectedOutlineIds.add(outlineId); setSelectedOutlineIds([outlineId]); setSelectedNodeIds([]); setSelectedImageIds([]); setSelectedStickyIds([]); setSelectedStampIds([]);
      }
    }
    if (isMulti) {
      groupDragStartMouse.current = { x: coords.x, y: coords.y };
      const initOutlinePos: Record<string, { x: number; y: number }> = {};
      newSelectedOutlineIds.forEach(id => { const o = outlines.find(ol=>ol.id===id); if (o) initOutlinePos[id] = { x: o.x, y: o.y }; });
      initialGroupOutlinePositions.current = initOutlinePos;
      setMultiDragOffsets({ dx: 0, dy: 0 }); setDraggingOutlineId(null); setSelectedEdgeId(null);
    } else {
      outlineDragOffset.current = { x: coords.x - outline.x, y: coords.y - outline.y };
      setDraggingOutlineId(outlineId); setSelectedEdgeId(null); setMultiDragOffsets(null);
    }
  }, [outlines, zoomLevel, isSpacePressed, selectedNodeIds, selectedImageIds, selectedStickyIds, selectedOutlineIds, selectedStampIds]);

  const handleMouseDownOnStamp = useCallback((e: ReactMouseEvent, stampId: string) => {
    if (e.button !== 0 || isSpacePressed) return; e.stopPropagation();
    const stamp = stamps.find(s => s.id === stampId); if (!stamp) return;
    const container = scrollContainerRef.current; if (!container) return;
    const coords = getCanvasCoords(e.clientX, e.clientY, container, zoomLevel);
    const targetGroupId = yStampsRef.current?.get(stampId)?.groupId;
    let isMulti = false;
    const newSelectedNodeIds = new Set<string>(); const newSelectedImageIds = new Set<string>(); const newSelectedStickyIds = new Set<string>(); const newSelectedOutlineIds = new Set<string>(); const newSelectedStampIds = new Set<string>();
    if (e.ctrlKey || e.metaKey) {
      isMulti = true;
      selectedNodeIds.forEach(id => newSelectedNodeIds.add(id)); selectedImageIds.forEach(id => newSelectedImageIds.add(id)); selectedStickyIds.forEach(id => newSelectedStickyIds.add(id)); selectedOutlineIds.forEach(id => newSelectedOutlineIds.add(id)); selectedStampIds.forEach(id => newSelectedStampIds.add(id));
      if (newSelectedStampIds.has(stampId)) newSelectedStampIds.delete(stampId); else newSelectedStampIds.add(stampId);
      setSelectedStampIds(Array.from(newSelectedStampIds));
    } else {
      if (selectedStampIds.includes(stampId) && (selectedNodeIds.length > 0 || selectedImageIds.length > 0 || selectedStickyIds.length > 0 || selectedOutlineIds.length > 0 || selectedStampIds.length > 1)) {
        isMulti = true;
        selectedNodeIds.forEach(id => newSelectedNodeIds.add(id)); selectedImageIds.forEach(id => newSelectedImageIds.add(id)); selectedStickyIds.forEach(id => newSelectedStickyIds.add(id)); selectedOutlineIds.forEach(id => newSelectedOutlineIds.add(id)); selectedStampIds.forEach(id => newSelectedStampIds.add(id));
      } else if (targetGroupId) {
        isMulti = true;
        yNodesRef.current?.forEach((v, k) => { if(v.groupId === targetGroupId) newSelectedNodeIds.add(k); });
        yImagesRef.current?.forEach((v, k) => { if(v.groupId === targetGroupId) newSelectedImageIds.add(k); });
        yStickiesRef.current?.forEach((v, k) => { if(v.groupId === targetGroupId) newSelectedStickyIds.add(k); });
        yOutlinesRef.current?.forEach((v, k) => { if(v.groupId === targetGroupId) newSelectedOutlineIds.add(k); });
        yStampsRef.current?.forEach((v, k) => { if(v.groupId === targetGroupId) newSelectedStampIds.add(k); });
        setSelectedNodeIds(Array.from(newSelectedNodeIds)); setSelectedImageIds(Array.from(newSelectedImageIds)); setSelectedStickyIds(Array.from(newSelectedStickyIds)); setSelectedOutlineIds(Array.from(newSelectedOutlineIds)); setSelectedStampIds(Array.from(newSelectedStampIds));
      } else {
        newSelectedStampIds.add(stampId); setSelectedStampIds([stampId]); setSelectedNodeIds([]); setSelectedImageIds([]); setSelectedStickyIds([]); setSelectedOutlineIds([]);
      }
    }
    if (isMulti) {
      groupDragStartMouse.current = { x: coords.x, y: coords.y };
      const initStampPos: Record<string, { x: number; y: number }> = {};
      newSelectedStampIds.forEach(id => { const st = stamps.find(s => s.id === id); if (st) initStampPos[id] = { x: st.x, y: st.y }; });
      initialGroupStampPositions.current = initStampPos;
      setMultiDragOffsets({ dx: 0, dy: 0 }); setDraggingStampId(null); setSelectedEdgeId(null);
    } else {
      stampDragOffset.current = { x: coords.x - stamp.x, y: coords.y - stamp.y };
      setDraggingStampId(stampId); setSelectedEdgeId(null); setMultiDragOffsets(null);
    }
  }, [stamps, zoomLevel, isSpacePressed, selectedNodeIds, selectedImageIds, selectedStickyIds, selectedOutlineIds, selectedStampIds]);

  const handleResizeHandleMouseDown = useCallback((e: ReactMouseEvent, imageId: string, handle: string) => { e.stopPropagation(); e.preventDefault(); setResizingImageHandle({ imageId, handle }); }, []);
  const handleStickyResizeHandleMouseDown = useCallback((e: ReactMouseEvent, stickyId: string, handle: string) => { e.stopPropagation(); e.preventDefault(); setResizingStickyHandle({ stickyId, handle }); }, []);
  const handleOutlineResizeHandleMouseDown = useCallback((e: ReactMouseEvent, outlineId: string, handle: string) => { e.stopPropagation(); e.preventDefault(); setResizingOutlineHandle({ outlineId, handle }); }, []);

  const handleCanvasMouseDown = useCallback((e: ReactMouseEvent) => {
    if (e.button !== 0) return;
    const container = scrollContainerRef.current; if (!container) return;
    if (isSpacePressed) {
      e.preventDefault(); setIsCanvasPanning(true);
      panStartCoords.current = { x: e.clientX, y: e.clientY, scrollLeft: container.scrollLeft, scrollTop: container.scrollTop };
      return;
    }
    const coords = getCanvasCoords(e.clientX, e.clientY, container, zoomLevel);
    if (currentTool !== 'select') {
      e.stopPropagation();
      addOutline(currentTool as 'rectangle'|'circle'|'triangle'|'text', coords.x, coords.y);
      setCurrentTool('select');
      return;
    }
    const nodeUnder = mindMap ? findNodeAtPoint(mindMap, coords.x, coords.y) : null;
    if (!nodeUnder) {
      setSelectedNodeIds([]); setSelectedImageIds([]); setSelectedStickyIds([]); setSelectedOutlineIds([]); setSelectedStampIds([]);
      setSelectedEdgeId(null);
      closeContextMenu();
      wasDraggingRef.current = true;
      setSelectionRect({ x1: coords.x, y1: coords.y, x2: coords.x, y2: coords.y });
    }
  }, [mindMap, zoomLevel, isSpacePressed, currentTool, addOutline, closeContextMenu]);

  const handleCanvasDoubleClick = useCallback((e: ReactMouseEvent) => {
    if (e.button !== 0 || isSpacePressed || currentTool !== 'select') return;
    const container = scrollContainerRef.current; if (!container) return;
    const coords = getCanvasCoords(e.clientX, e.clientY, container, zoomLevel);
    const nodeUnder = mindMap ? findNodeAtPoint(mindMap, coords.x, coords.y) : null;
    if (!nodeUnder) { addNodeAtPosition(coords.x, coords.y, false); }
  }, [mindMap, zoomLevel, isSpacePressed, currentTool, addNodeAtPosition]);

  const handleMouseMove = useCallback((e: MouseEvent | ReactMouseEvent) => {
    const container = scrollContainerRef.current; if (!container) return;
    if (isCanvasPanning) { const dx = e.clientX - panStartCoords.current.x, dy = e.clientY - panStartCoords.current.y; container.scrollLeft = panStartCoords.current.scrollLeft - dx; container.scrollTop = panStartCoords.current.scrollTop - dy; return; }
    const coords = getCanvasCoords(e.clientX, e.clientY, container, zoomLevel);
    if (editingEdgeEndpoint) {
      const { edgeId, endpoint } = editingEdgeEndpoint; const edge = edges.find((eg: EdgeData) => eg.id === edgeId); if (!edge) return;
      const nodeId = endpoint === 'source' ? edge.sourceNodeId : edge.targetNodeId; const node = mindMap ? findNodeById(mindMap, nodeId) : null; if (!node) return;
      const display = getNodeDisplayPos(nodeId, mindMap, dragPositions, draggingNodeId) || { x: node.x, y: node.y, width: node.width ?? NODE_WIDTH, height: node.height ?? NODE_HEIGHT };
      const closestPoint = findClosestConnectionPoint(display.x, display.y, coords.x, coords.y, display.width, display.height); updateEdgeEndpoint(edgeId, endpoint, closestPoint); return;
    }
    if (drawingEdge) {
      const nodeUnder = mindMap ? findNodeAtPoint(mindMap, coords.x, coords.y, drawingEdge.sourceNodeId) : null;
      if (nodeUnder) {
        const w = nodeUnder.width ?? NODE_WIDTH;
        const h = nodeUnder.height ?? NODE_HEIGHT;
        const pt = findClosestConnectionPoint(nodeUnder.x, nodeUnder.y, coords.x, coords.y, w, h);
        const snappedCoords = getConnectionPoint(nodeUnder.x, nodeUnder.y, pt, w, h);
        setDrawingEdge(prev => prev ? { ...prev, currentX: snappedCoords.x, currentY: snappedCoords.y, targetNodeId: nodeUnder.id, targetPoint: pt } : null);
      } else {
        setDrawingEdge(prev => prev ? { ...prev, currentX: coords.x, currentY: coords.y, targetNodeId: undefined, targetPoint: undefined } : null);
      }
      return;
    }
    if (draggingImageId) { updateImagePosition(draggingImageId, coords.x - imageDragOffset.current.x, coords.y - imageDragOffset.current.y); return; }
    if (draggingStickyId) { updateStickyPosition(draggingStickyId, coords.x - stickyDragOffset.current.x, coords.y - stickyDragOffset.current.y); return; }
    if (draggingOutlineId) { updateOutlinePosition(draggingOutlineId, coords.x - outlineDragOffset.current.x, coords.y - outlineDragOffset.current.y); return; }
    if (draggingStampId) { updateStampPosition(draggingStampId, coords.x - stampDragOffset.current.x, coords.y - stampDragOffset.current.y); return; }
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
      updateStickySize(sticky.id, newWidth, newHeight); if (h.includes('w') || h.includes('n')) updateStickyPosition(sticky.id, newX, newY);
      return;
    }
    if (resizingOutlineHandle) {
      const outline = outlines.find((o: OutlineData) => o.id === resizingOutlineHandle.outlineId); if (!outline) return;
      let newWidth = outline.width, newHeight = outline.height, newX = outline.x, newY = outline.y; const h = resizingOutlineHandle.handle;
      if (h.includes('e')) newWidth = Math.max(30, coords.x - outline.x); if (h.includes('s')) newHeight = Math.max(30, coords.y - outline.y);
      if (h.includes('w')) { const diff = outline.x - coords.x; newWidth = Math.max(30, diff); newX = coords.x; }
      if (h.includes('n')) { const diff = outline.y - coords.y; newHeight = Math.max(30, diff); newY = coords.y; }
      updateOutlineSize(outline.id, newWidth, newHeight); if (h.includes('w') || h.includes('n')) updateOutlinePosition(outline.id, newX, newY);
      return;
    }
    if (selectionRect) { setSelectionRect(prev => prev ? { ...prev, x2: coords.x, y2: coords.y } : null); return; }
    if (draggingNodeId) {
      const newX = coords.x - dragOffset.current.x, newY = coords.y - dragOffset.current.y;
      setDragPositions(prev => ({ ...prev, [draggingNodeId]: { x: newX, y: newY } }));
      if (mindMap) { const target = findNodeAtPoint(mindMap, coords.x, coords.y, draggingNodeId); setDragTargetNodeId(target && target.id !== draggingNodeId ? target.id : null); }
      return;
    }
    if (isMultiDragging && multiDragOffsets) {
      const deltaX = coords.x - groupDragStartMouse.current.x;
      const deltaY = coords.y - groupDragStartMouse.current.y;
      setMultiDragOffsets({ dx: deltaX, dy: deltaY });
      const newPositions: Record<string, { x: number; y: number }> = {};
      selectedNodeIds.forEach(id => { const init = initialGroupDragPositions.current[id]; if(init) newPositions[id] = { x: init.x + deltaX, y: init.y + deltaY }; });
      setDragPositions(newPositions);
    }
  }, [editingEdgeEndpoint, drawingEdge, draggingImageId, draggingStickyId, draggingOutlineId, draggingStampId, resizingImageHandle, resizingStickyHandle, resizingOutlineHandle, selectionRect, draggingNodeId, isMultiDragging, multiDragOffsets, selectedNodeIds, dragPositions, mindMap, edges, updateEdgeEndpoint, zoomLevel, updateImagePosition, updateStickyPosition, updateOutlinePosition, updateStickySize, updateOutlineSize, updateStampPosition, images, stickies, outlines, isCanvasPanning]);

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
          const tw = targetNode.width ?? NODE_WIDTH;
          const th = targetNode.height ?? NODE_HEIGHT;
          const pt = findClosestConnectionPoint(targetNode.x, targetNode.y, drawingEdge.currentX, drawingEdge.currentY, tw, th); 
          addEdge(drawingEdge.sourceNodeId, drawingEdge.sourcePoint, targetNode.id, pt); 
        }
      }
      setDrawingEdge(null); return; 
    }
    if (draggingImageId) { setDraggingImageId(null); return; }
    if (draggingStickyId) { setDraggingStickyId(null); return; }
    if (draggingOutlineId) { setDraggingOutlineId(null); return; }
    if (draggingStampId) { setDraggingStampId(null); return; }
    if (resizingImageHandle) { setResizingImageHandle(null); return; }
    if (resizingStickyHandle) { setResizingStickyHandle(null); return; }
    if (resizingOutlineHandle) { setResizingOutlineHandle(null); return; }
    if (selectionRect) {
      if (mindMap) { 
        const _selNodes: string[] = []; 
        const collectNodes = (node: MindNode) => { if (isNodeInRect(node, selectionRect)) _selNodes.push(node.id); node.children.forEach((c: MindNode) => collectNodes(c)); }; 
        collectNodes(mindMap);
        const _selImages: string[] = [];
        images.forEach(img => { if(isImageInRect(img, selectionRect)) _selImages.push(img.id); });
        const _selStickies: string[] = [];
        stickies.forEach(st => { if(isStickyInRect(st, selectionRect)) _selStickies.push(st.id); });
        const _selOutlines: string[] = [];
        outlines.forEach(ol => { if(isOutlineInRect(ol, selectionRect)) _selOutlines.push(ol.id); });
        const _selStamps: string[] = [];
        stamps.forEach(st => { if(isStampInRect(st, selectionRect)) _selStamps.push(st.id); });
        setSelectedNodeIds(_selNodes); setSelectedImageIds(_selImages); setSelectedStickyIds(_selStickies); setSelectedOutlineIds(_selOutlines); setSelectedStampIds(_selStamps);
      }
      setSelectionRect(null); return;
    }
    if (draggingNodeId) {
      const pos = dragPositions[draggingNodeId]; if (pos) updatePosition(draggingNodeId, pos.x, pos.y);
      if (dragTargetNodeId && dragTargetNodeId !== draggingNodeId) reparentNode(draggingNodeId, dragTargetNodeId);
      setDraggingNodeId(null); setDragTargetNodeId(null); setDragPositions(prev => { const { [draggingNodeId]: _, ...rest } = prev; return rest; }); return;
    }
    if (isMultiDragging && multiDragOffsets) {
      ydocRef.current?.transact(() => {
        selectedNodeIds.forEach(id => { const p = initialGroupDragPositions.current[id]; if (p) { const n = yNodesRef.current?.get(id); if(n) yNodesRef.current?.set(id, {...n, x: p.x + multiDragOffsets.dx, y: p.y + multiDragOffsets.dy}); } });
        selectedImageIds.forEach(id => { const p = initialGroupImagePositions.current[id]; if (p) { const n = yImagesRef.current?.get(id); if(n) yImagesRef.current?.set(id, {...n, x: p.x + multiDragOffsets.dx, y: p.y + multiDragOffsets.dy}); } });
        selectedStickyIds.forEach(id => { const p = initialGroupStickyPositions.current[id]; if (p) { const n = yStickiesRef.current?.get(id); if(n) yStickiesRef.current?.set(id, {...n, x: p.x + multiDragOffsets.dx, y: p.y + multiDragOffsets.dy}); } });
        selectedOutlineIds.forEach(id => { const p = initialGroupOutlinePositions.current[id]; if (p) { const n = yOutlinesRef.current?.get(id); if(n) yOutlinesRef.current?.set(id, {...n, x: p.x + multiDragOffsets.dx, y: p.y + multiDragOffsets.dy}); } });
        selectedStampIds.forEach(id => { const p = initialGroupStampPositions.current[id]; if (p) { const n = yStampsRef.current?.get(id); if(n) yStampsRef.current?.set(id, {...n, x: p.x + multiDragOffsets.dx, y: p.y + multiDragOffsets.dy}); } });
      });
      setDragPositions({}); 
      initialGroupDragPositions.current = {}; initialGroupImagePositions.current = {}; initialGroupStickyPositions.current = {}; initialGroupOutlinePositions.current = {}; initialGroupStampPositions.current = {};
      setMultiDragOffsets(null);
      return;
    }
  }, [editingEdgeEndpoint, drawingEdge, draggingImageId, draggingStickyId, draggingOutlineId, draggingStampId, resizingImageHandle, resizingStickyHandle, resizingOutlineHandle, selectionRect, draggingNodeId, isMultiDragging, multiDragOffsets, selectedNodeIds, selectedImageIds, selectedStickyIds, selectedOutlineIds, selectedStampIds, dragPositions, dragTargetNodeId, mindMap, addEdge, updatePosition, reparentNode, isCanvasPanning, images, stickies, outlines, stamps]);

  useEffect(() => {
    if (isAnyDragging) { 
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
  }, [isAnyDragging, handleMouseMove, handleMouseUp]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (editingNodeId || editingStickyId || editingMapId !== null || editingOutlineId !== null || showHelpModal) return;
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); handleSave(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); e.shiftKey ? handleRedo() : handleUndo(); return; }
    if (e.altKey && (e.ctrlKey || e.metaKey) && e.key === 'f') { e.preventDefault(); setZenMode(prev => !prev); return; }
    if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '-' || e.key === '=')) { e.preventDefault(); changeZoom(e.key === '-' ? -0.1 : 0.1); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace')) {
      if (selectedEdgeId && !selectedNodeId && !selectedImageId && !selectedStickyId && !selectedOutlineId && !selectedStampId) { e.preventDefault(); deleteEdge(selectedEdgeId); return; }
      if (selectedNodeIds.includes(yRootRef.current!)) { e.preventDefault(); return; }
      if (selectedNodeIds.length > 0 || selectedImageIds.length > 0 || selectedStickyIds.length > 0 || selectedOutlineIds.length > 0 || selectedStampIds.length > 0) {
        e.preventDefault();
        ydocRef.current?.transact(() => {
          selectedNodeIds.forEach(id => { if (id !== yRootRef.current) deleteNode(id); });
          selectedImageIds.forEach(id => deleteImage(id));
          selectedStickyIds.forEach(id => deleteSticky(id));
          selectedOutlineIds.forEach(id => deleteOutline(id));
          selectedStampIds.forEach(id => deleteStamp(id));
        });
        setSelectedNodeIds([]); setSelectedImageIds([]); setSelectedStickyIds([]); setSelectedOutlineIds([]); setSelectedStampIds([]);
        return;
      }
    }
    if (!selectedNodeId || selectedNodeIds.length > 1) return;
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
        if (valid) { const dist = Math.hypot(dx, dy); if (dist < minDist) { minDist = dist; closest = n; } }
      }
      if (closest) {
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
      if (node?.independent) addIndependentSibling(selectedNodeId, 'after');
      else addSiblingNode(selectedNodeId, 'after');
      return;
    }
    if (e.key === 'Enter' && e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const node = mindMap ? findNodeById(mindMap, selectedNodeId) : null;
      if (node?.independent) addIndependentSibling(selectedNodeId, 'before');
      else addSiblingNode(selectedNodeId, 'before');
      return;
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); addParentNode(selectedNodeId); return; }
    if (e.key === 'Tab') { e.preventDefault(); addChildNode(selectedNodeId); return; }
  }, [editingNodeId, editingStickyId, editingOutlineId, editingMapId, showHelpModal, selectedNodeId, selectedNodeIds, selectedImageIds, selectedStickyIds, selectedOutlineIds, selectedStampIds, selectedEdgeId, selectedImageId, selectedStickyId, selectedOutlineId, selectedStampId, mindMap, zoomLevel, handleSave, handleUndo, handleRedo, addChildNode, addSiblingNode, addIndependentSibling, addParentNode, deleteEdge, changeZoom]);

  const handleNodeContextMenu = useCallback((e: ReactMouseEvent, nodeId: string) => { e.preventDefault(); e.stopPropagation(); setContextMenu({ visible: true, x: e.clientX, y: e.clientY, type: 'node', nodeId }); setShowColorPalette(null); }, []);
  const handleCanvasContextMenu = useCallback((e: ReactMouseEvent) => { e.preventDefault(); const container = scrollContainerRef.current; if (!container) return; const coords = getCanvasCoords(e.clientX, e.clientY, container, zoomLevel); setContextMenu({ visible: true, x: e.clientX, y: e.clientY, type: 'canvas', canvasX: coords.x, canvasY: coords.y }); }, [zoomLevel]);
  const handleImageContextMenu = useCallback((e: ReactMouseEvent, imageId: string) => { e.preventDefault(); e.stopPropagation(); setSelectedImageIds([imageId]); setContextMenu({ visible: true, x: e.clientX, y: e.clientY, type: 'image', imageId }); }, []);
  const handleStickyContextMenu = useCallback((e: ReactMouseEvent, stickyId: string) => { e.preventDefault(); e.stopPropagation(); setSelectedStickyIds([stickyId]); setContextMenu({ visible: true, x: e.clientX, y: e.clientY, type: 'sticky', stickyId }); }, []);
  const handleOutlineContextMenu = useCallback((e: ReactMouseEvent, outlineId: string) => { e.preventDefault(); e.stopPropagation(); setSelectedOutlineIds([outlineId]); setContextMenu({ visible: true, x: e.clientX, y: e.clientY, type: 'outline', outlineId }); }, []);
  const handleStampContextMenu = useCallback((e: ReactMouseEvent, stampId: string) => { e.preventDefault(); e.stopPropagation(); setSelectedStampIds([stampId]); setContextMenu({ visible: true, x: e.clientX, y: e.clientY, type: 'stamp', stampId }); }, []);

  const executeContextAction = useCallback((action: string) => {
    closeContextMenu();
    if (contextMenu.type === 'node' && contextMenu.nodeId) {
      const nodeId = contextMenu.nodeId;
      const node = mindMap ? findNodeById(mindMap, nodeId) : null;
      switch (action) {
        case 'addChild': addChildNode(nodeId); break;
        case 'addSiblingAfter': if (node?.independent) addIndependentSibling(nodeId, 'after'); else addSiblingNode(nodeId, 'after'); break;
        case 'addSiblingBefore': if (node?.independent) addIndependentSibling(nodeId, 'before'); else addSiblingNode(nodeId, 'before'); break;
        case 'addParent': addParentNode(nodeId); break;
        case 'delete': deleteNode(nodeId); break;
        case 'alignVertical': alignNodes('vertical'); break;
        case 'alignHorizontal': alignNodes('horizontal'); break;
        case 'bringToFront': bringToFront(); break;
        case 'sendToBack': sendToBack(); break;
        case 'toggleCollapse': if (nodeId !== yRootRef.current) toggleNodeCollapse(nodeId); break;
      }
    } else if (contextMenu.type === 'edge' && contextMenu.edgeId) {
      switch (action) { case 'deleteEdge': deleteEdge(contextMenu.edgeId); break; case 'arrowNone': updateEdgeArrow(contextMenu.edgeId, 'none'); break; case 'arrowStart': updateEdgeArrow(contextMenu.edgeId, 'start'); break; case 'arrowEnd': updateEdgeArrow(contextMenu.edgeId, 'end'); break; case 'arrowBoth': updateEdgeArrow(contextMenu.edgeId, 'both'); break; }
    } else if (contextMenu.type === 'image' && contextMenu.imageId) {
      if (action === 'deleteImage') deleteImage(contextMenu.imageId); else if (action === 'bringToFront') bringToFront(); else if (action === 'sendToBack') sendToBack();
    } else if (contextMenu.type === 'sticky' && contextMenu.stickyId) {
      switch (action) { case 'deleteSticky': deleteSticky(contextMenu.stickyId); break; case 'changeColor': setShowColorPalette({ stickyId: contextMenu.stickyId, x: contextMenu.x, y: contextMenu.y }); break; case 'bringToFront': bringToFront(); break; case 'sendToBack': sendToBack(); break; }
    } else if (contextMenu.type === 'outline' && contextMenu.outlineId) {
      switch (action) { case 'deleteOutline': deleteOutline(contextMenu.outlineId); break; case 'changeColor': setShowColorPalette({ outlineId: contextMenu.outlineId, x: contextMenu.x, y: contextMenu.y }); break; case 'bringToFront': bringToFront(); break; case 'sendToBack': sendToBack(); break; }
    } else if (contextMenu.type === 'stamp' && contextMenu.stampId) {
      switch (action) { case 'deleteStamp': deleteStamp(contextMenu.stampId); break; case 'bringToFront': bringToFront(); break; case 'sendToBack': sendToBack(); break; }
    } else if (contextMenu.type === 'canvas') {
      if (action === 'addNode' && contextMenu.canvasX !== undefined && contextMenu.canvasY !== undefined) addNodeAtPosition(contextMenu.canvasX, contextMenu.canvasY, false);
      else if (action === 'addImageNode' && contextMenu.canvasX !== undefined && contextMenu.canvasY !== undefined) addImageNodeWithUpload(contextMenu.canvasX, contextMenu.canvasY);
      else if (action === 'addSticky' && contextMenu.canvasX !== undefined && contextMenu.canvasY !== undefined) addSticky(contextMenu.canvasX, contextMenu.canvasY);
      else if (action === 'addStamp' && contextMenu.canvasX !== undefined && contextMenu.canvasY !== undefined) addStamp(contextMenu.canvasX, contextMenu.canvasY);
      else if (action === 'addImage') fileInputRef.current?.click();
    }
  }, [contextMenu, closeContextMenu, mindMap, addChildNode, addSiblingNode, addIndependentSibling, addParentNode, deleteNode, deleteEdge, updateEdgeArrow, addNodeAtPosition, addImageNodeWithUpload, addSticky, addStamp, alignNodes, deleteImage, deleteSticky, deleteOutline, deleteStamp, bringToFront, sendToBack, toggleNodeCollapse]);

  const handleNodeClick = useCallback((e: ReactMouseEvent, nodeId: string) => { e.stopPropagation(); if (showColorPalette) { setShowColorPalette(null); return; } if (e.ctrlKey || e.metaKey) { setSelectedNodeIds(prev => prev.includes(nodeId) ? prev.filter(id => id !== nodeId) : [...prev, nodeId]); } else { setSelectedNodeIds([nodeId]); setSelectedImageIds([]); setSelectedStickyIds([]); setSelectedOutlineIds([]); setSelectedStampIds([]); } setSelectedEdgeId(null); closeContextMenu(); }, [closeContextMenu, showColorPalette]);
  const handleImageClick = useCallback((e: ReactMouseEvent, imageId: string) => { e.stopPropagation(); if (showColorPalette) { setShowColorPalette(null); return; } if (e.ctrlKey || e.metaKey) setSelectedImageIds(prev => prev.includes(imageId) ? prev.filter(id => id !== imageId) : [...prev, imageId]); else { setSelectedImageIds([imageId]); setSelectedNodeIds([]); setSelectedStickyIds([]); setSelectedOutlineIds([]); setSelectedStampIds([]); } setSelectedEdgeId(null); closeContextMenu(); }, [closeContextMenu, showColorPalette]);
  const handleStickyClick = useCallback((e: ReactMouseEvent, stickyId: string) => { e.stopPropagation(); if (showColorPalette) { setShowColorPalette(null); return; } if (e.ctrlKey || e.metaKey) setSelectedStickyIds(prev => prev.includes(stickyId) ? prev.filter(id => id !== stickyId) : [...prev, stickyId]); else { setSelectedStickyIds([stickyId]); setSelectedNodeIds([]); setSelectedImageIds([]); setSelectedOutlineIds([]); setSelectedStampIds([]); } setSelectedEdgeId(null); closeContextMenu(); }, [closeContextMenu, showColorPalette]);
  const handleOutlineClick = useCallback((e: ReactMouseEvent, outlineId: string) => { e.stopPropagation(); if (showColorPalette) { setShowColorPalette(null); return; } if (e.ctrlKey || e.metaKey) setSelectedOutlineIds(prev => prev.includes(outlineId) ? prev.filter(id => id !== outlineId) : [...prev, outlineId]); else { setSelectedOutlineIds([outlineId]); setSelectedNodeIds([]); setSelectedImageIds([]); setSelectedStickyIds([]); setSelectedStampIds([]); } setSelectedEdgeId(null); closeContextMenu(); }, [closeContextMenu, showColorPalette]);
  const handleStampClick = useCallback((e: ReactMouseEvent, stampId: string) => { e.stopPropagation(); if (showColorPalette) { setShowColorPalette(null); return; } if (e.ctrlKey || e.metaKey) setSelectedStampIds(prev => prev.includes(stampId) ? prev.filter(id => id !== stampId) : [...prev, stampId]); else { setSelectedStampIds([stampId]); setSelectedNodeIds([]); setSelectedImageIds([]); setSelectedStickyIds([]); setSelectedOutlineIds([]); } setSelectedEdgeId(null); closeContextMenu(); }, [closeContextMenu, showColorPalette]);

  const handleNodeDoubleClick = useCallback((e: ReactMouseEvent, nodeId: string) => {
    e.stopPropagation();
    const node = mindMap ? findNodeById(mindMap, nodeId) : null;
    if (node?.imageUrl) { setImageModalUrl(node.imageUrl); }
    else { setEditingNodeId(nodeId); }
  }, [mindMap]);
  const handleCanvasClick = () => { if (wasDraggingRef.current || isCanvasPanning) { wasDraggingRef.current = false; return; } closeContextMenu(); };
  const handleTextEditComplete = (nodeId: string, newText: string) => { const trimmed = newText.trim(); if (trimmed) updateText(nodeId, trimmed); setEditingNodeId(null); };
  const handleEdgeClick = useCallback((e: ReactMouseEvent, edgeId: string) => { e.stopPropagation(); setSelectedNodeIds([]); setSelectedImageIds([]); setSelectedStickyIds([]); setSelectedOutlineIds([]); setSelectedStampIds([]); setSelectedEdgeId(edgeId); closeContextMenu(); }, [closeContextMenu]);
  const handleEdgeContextMenu = useCallback((e: ReactMouseEvent, edgeId: string) => { e.preventDefault(); e.stopPropagation(); setSelectedEdgeId(edgeId); setContextMenu({ visible: true, x: e.clientX, y: e.clientY, type: 'edge', edgeId }); }, []);
  const handleEdgeEndpointMouseDown = useCallback((e: ReactMouseEvent, edgeId: string, endpoint: 'source' | 'target') => { e.stopPropagation(); e.preventDefault(); setEditingEdgeEndpoint({ edgeId, endpoint }); }, []);

  const handleConnectionPointMouseDown = useCallback((e: ReactMouseEvent, nodeId: string, point: ConnectionPoint) => {
    e.stopPropagation(); e.preventDefault();
    const node = mindMap ? findNodeById(mindMap, nodeId) : null; if (!node) return;
    const w = node.width ?? (node.imageUrl ? (node.imageWidth && node.imageScale ? node.imageWidth * node.imageScale : NODE_WIDTH) : NODE_WIDTH);
    const h = node.height ?? (node.imageUrl ? (node.imageHeight && node.imageScale ? node.imageHeight * node.imageScale : NODE_HEIGHT) : NODE_HEIGHT);
    const pt = getConnectionPoint(node.x, node.y, point, w, h);
    setDrawingEdge({ sourceNodeId: nodeId, sourcePoint: point, currentX: pt.x, currentY: pt.y });
  }, [mindMap]);

  const handleCanvasDrop = useCallback(async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    const container = scrollContainerRef.current;
    if (!container) return;
    const coords = getCanvasCoords(e.clientX, e.clientY, container, zoomLevel);
    const fileExt = file.name.split('.').pop(); 
    const fileName = `${crypto.randomUUID()}.${fileExt}`;
    const { data, error } = await supabase.storage.from('images').upload(fileName, file);
    if (error) { alert('画像のアップロードに失敗しました'); return; }
    const path = data.path;
    const img = new Image();
    img.src = URL.createObjectURL(file);
    img.onload = () => {
      const MAX_DIM = 200;
      let w = img.width, h = img.height;
      if (w > MAX_DIM || h > MAX_DIM) { const ratio = Math.min(MAX_DIM / w, MAX_DIM / h); w = Math.round(w * ratio); h = Math.round(h * ratio); }
      const yImages = yImagesRef.current;
      if (!yImages || !ydocRef.current) return;
      const imageId = crypto.randomUUID();
      ydocRef.current.transact(() => { yImages.set(imageId, { storagePath: path, x: coords.x - w / 2, y: coords.y - h / 2, width: w, height: h }); });
    };
  }, [zoomLevel]);

  // ==================== JSX レンダリング ====================
  const statusColor = connectionStatus === '接続済み' ? 'bg-emerald-500' : (connectionStatus === '切断' || connectionStatus === 'タイムアウト' ? 'bg-rose-500' : 'bg-amber-500');

  if (!mindMap) {
    return (
      <div className="flex h-screen bg-slate-50">
        <div className="w-[280px] flex-shrink-0 h-full bg-white border-r border-slate-200 shadow-sm z-[100] flex flex-col">
          <div className="p-4 border-b border-slate-100 flex flex-col gap-3 bg-white">
            <div className="flex items-center justify-between">
              <h2 className="font-extrabold text-slate-800 tracking-tight flex items-center gap-2">
                <svg className="w-6 h-6 text-indigo-600 drop-shadow-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="3" strokeWidth="2.5" fill="#e0e7ff"/><circle cx="6" cy="6" r="2" strokeWidth="2.5"/><circle cx="18" cy="6" r="2" strokeWidth="2.5"/><circle cx="6" cy="18" r="2" strokeWidth="2.5"/><circle cx="18" cy="18" r="2" strokeWidth="2.5"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8.5 8.5L10.5 10.5M15.5 8.5L13.5 10.5M8.5 15.5L10.5 13.5M15.5 15.5L13.5 13.5"/></svg>
                MindMap Pro
              </h2>
              <div className="flex items-center gap-1.5 px-2 py-1 bg-slate-50 rounded border border-slate-200" title={connectionStatus}>
                <div className={`w-2 h-2 rounded-full ${statusColor} ${connectionStatus === '接続済み' ? 'animate-pulse' : ''}`} />
                <span className="text-[10px] font-medium text-slate-500">{connectionStatus === '接続済み' ? 'Online' : 'Offline'}</span>
              </div>
            </div>
          </div>
          <div className="p-4 border-b border-slate-100 flex flex-col gap-3">
            <button onClick={handleNewMap} className="flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white py-2.5 rounded-lg shadow-sm w-full font-medium transition-colors"><PlusIcon /> 新規マップ作成</button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 bg-slate-50/50">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 px-1">Recent Maps</h3>
            {savedMaps.length === 0 ? (
              <div className="text-sm text-slate-400 text-center py-8 bg-white border border-slate-100 rounded-lg border-dashed">まだマップがありません</div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {savedMaps.map((map: MapRecord, index: number) => (
                  <div key={map.id} draggable onDragStart={(e) => handleMapDragStart(e, index)} onDragEnter={(e) => handleMapDragEnter(e, index)} onDragEnd={handleMapDragEnd} onDragOver={(e) => e.preventDefault()} className={`group flex flex-col rounded-lg border transition-all cursor-grab active:cursor-grabbing ${mapId === map.id ? 'bg-indigo-50 border-indigo-200 shadow-sm' : 'bg-white border-transparent hover:border-slate-200 hover:shadow-sm'}`}>
                    {editingMapId === map.id ? (
                      <div className="px-3 py-2.5 bg-white rounded-t-lg flex items-center gap-2">
                        <GripVerticalIcon />
                        <input autoFocus value={editMapTitle} onChange={e => setEditMapTitle(e.target.value)} onBlur={() => handleSaveTitleOnly(map.id, editMapTitle)} onKeyDown={e => { if (e.key === 'Enter') handleSaveTitleOnly(map.id, editMapTitle); if (e.key === 'Escape') setEditingMapId(null); }} className="w-full text-sm font-semibold text-indigo-900 bg-transparent border-b-2 border-indigo-500 outline-none pb-0.5" />
                      </div>
                    ) : (
                      <div className="flex items-center justify-between w-full relative overflow-hidden">
                        <div className="pl-2 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"><GripVerticalIcon /></div>
                        <button onClick={() => handleLoadMap(map)} className={`flex-1 text-left px-2 py-2.5 rounded-t-lg text-sm transition-colors truncate ${mapId === map.id ? 'text-indigo-900 font-semibold' : 'text-slate-700 font-medium'}`}>{map.title}</button>
                        <button onClick={(e) => { e.stopPropagation(); setEditMapTitle(map.title); setEditingMapId(map.id); }} className={`absolute right-2 p-1.5 opacity-0 group-hover:opacity-100 bg-slate-100/80 hover:bg-slate-200 rounded text-slate-500 hover:text-indigo-600 transition-all ${mapId === map.id ? 'opacity-100' : ''}`} title="タイトルを変更"><PencilIcon /></button>
                      </div>
                    )}
                    <div className="flex flex-col px-3 pb-2.5 pt-1 cursor-default">
                      <div className="flex items-center justify-between w-full">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-500" title={map.user_id === user.id ? undefined : `オーナー: ${map.owner_email || '不明'}`}>
                            {map.user_id === user.id ? '👑 オーナー' : '🤝 共有'}
                          </span>
                          <div className={`flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity ${mapId === map.id ? 'opacity-100' : ''}`}>
                            <button onClick={(e) => { e.stopPropagation(); handleCopyMap(map, e); }} className="p-1.5 hover:bg-slate-200 rounded text-slate-500 hover:text-slate-700 transition-colors" title="コピー"><CopyIcon /></button>
                            {map.user_id === user.id ? (
                              <button onClick={(e) => { e.stopPropagation(); handleDeleteMap(map, e); }} className="p-1.5 hover:bg-rose-100 rounded text-slate-500 hover:text-rose-600 transition-colors" title="削除"><TrashIcon /></button>
                            ) : (
                              <button onClick={(e) => { e.stopPropagation(); handleLeaveMap(map, e); }} className="p-1.5 hover:bg-amber-100 rounded text-slate-500 hover:text-amber-600 transition-colors" title="退出"><LeaveIcon /></button>
                            )}
                          </div>
                        </div>
                        <span className="text-[10px] text-slate-400">{map.updated_at ? new Date(map.updated_at).toLocaleString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}</span>
                      </div>
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
        <div className="flex-1 flex items-center justify-center bg-slate-50">
          <div className="text-center">
            <p className="text-slate-500 mb-4">マップが選択されていません</p>
            <button onClick={handleNewMap} className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-lg shadow-md font-medium transition-colors">
              新規マップを作成
            </button>
          </div>
        </div>
      </div>
    );
  }

  const flatNodes = flattenTree(mindMap);

  const edgeLines: { id: string; pathD: string; selected: boolean; arrow: string; sourceX: number; sourceY: number; targetX: number; targetY: number }[] = [];
  for (const edge of edges) {
    const sourcePos = getNodeDisplayPos(edge.sourceNodeId, mindMap, dragPositions, draggingNodeId);
    const targetPos = getNodeDisplayPos(edge.targetNodeId, mindMap, dragPositions, draggingNodeId);
    if (!sourcePos || !targetPos) continue;
    const startPt = getConnectionPoint(sourcePos.x, sourcePos.y, edge.sourcePoint, sourcePos.width, sourcePos.height);
    const endPt = getConnectionPoint(targetPos.x, targetPos.y, edge.targetPoint, targetPos.width, targetPos.height);
    const pathD = getEdgePath(startPt, endPt, edge.sourcePoint, edge.targetPoint, edgeStyle);
    edgeLines.push({ id: edge.id, pathD, selected: selectedEdgeId === edge.id, arrow: edge.arrow || 'none', sourceX: startPt.x, sourceY: startPt.y, targetX: endPt.x, targetY: endPt.y });
  }

  const ownAwareness = awarenessStates[myUserId];
  const participantsMap = new Map<string, Participant>();
  participantsMap.set(myUserId, { user_id: myUserId, email: myEmail, color: myColor, isOnline: true, isSelf: true, selectedNodeId: ownAwareness?.selectedNodeId ?? null, editingNodeId: ownAwareness?.editingNodeId ?? null, cursorX: ownAwareness?.cursorX, cursorY: ownAwareness?.cursorY, mouseInCanvas: ownAwareness?.mouseInCanvas });
  mapMembers.forEach((member) => { if (member.user_id !== myUserId) participantsMap.set(member.user_id, { user_id: member.user_id, email: member.email, color: stringToColor(member.email), isOnline: false, isSelf: false, selectedNodeId: null, editingNodeId: null }); });
  Object.entries(awarenessStates).forEach(([userId, state]) => { if (userId === myUserId) return; participantsMap.set(userId, { user_id: userId, email: state.email, color: state.color, isOnline: true, isSelf: false, selectedNodeId: state.selectedNodeId, editingNodeId: state.editingNodeId, cursorX: state.cursorX, cursorY: state.cursorY, mouseInCanvas: state.mouseInCanvas }); });
  const allParticipants = Array.from(participantsMap.values());

  const getImageUrl = (storagePath: string) => { const { data } = supabase.storage.from('images').getPublicUrl(storagePath); return data.publicUrl; };
  const canvasScrollClass = `w-full h-full overflow-auto relative ${isSpacePressed ? (isCanvasPanning ? 'cursor-grabbing' : 'cursor-grab') : (currentTool !== 'select' ? 'cursor-crosshair' : '')}`;
  const hideScrollbarStyle = { scrollbarWidth: 'none' as const, msOverflowStyle: 'none' as const, WebkitOverflowScrolling: 'touch', outline: 'none' };
  const remoteCursors = allParticipants.filter(p => !p.isSelf && p.mouseInCanvas && p.cursorX !== undefined && p.cursorY !== undefined);

  const showFloatingToolbar = selectedNodeIds.length === 1 && selectedNodeId && !draggingNodeId && !isCanvasPanning && !isSpacePressed && !drawingEdge && !selectionRect;
  const floatingToolbarPos = showFloatingToolbar && mindMap ? getNodeDisplayPos(selectedNodeId!, mindMap, dragPositions, draggingNodeId) : null;

  return (
    <div className="relative h-screen w-screen overflow-hidden flex bg-slate-50 text-slate-800" style={{ fontFamily: "'Inter', 'Noto Sans JP', sans-serif" }}>
      <style>{`.hide-scrollbar::-webkit-scrollbar { display: none; }`}</style>
      <input type="file" ref={fileInputRef} onChange={handleImageUpload} accept="image/*" className="hidden" />
      <input type="file" ref={imageFileInputRef} accept="image/*" className="hidden" />
      {imageModalUrl && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={() => setImageModalUrl(null)}>
          <div className="relative max-w-[90vw] max-h-[90vh] bg-white rounded-xl shadow-2xl p-2" onClick={e => e.stopPropagation()}>
            <button onClick={() => setImageModalUrl(null)} className="absolute -top-4 -right-4 bg-white rounded-full p-1 shadow-lg hover:bg-slate-100 transition-colors z-10"><CloseIcon /></button>
            <img src={imageModalUrl} alt="拡大画像" className="max-w-full max-h-[85vh] object-contain rounded" />
          </div>
        </div>
      )}
      {showInviteModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm" onClick={() => { setShowInviteModal(false); setInviteMessage(''); setInviteEmail(''); setInviteLink(''); }}>
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md border border-slate-100" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-slate-800">チームメンバーを招待</h3>
              <button onClick={() => { setShowInviteModal(false); setInviteMessage(''); setInviteEmail(''); setInviteLink(''); }} className="text-slate-400 hover:text-slate-600 transition-colors">&times;</button>
            </div>
            <p className="text-sm text-slate-500 mb-4">Googleアカウントのメールアドレスを入力して、共同編集者を招待します。</p>
            <div className="flex gap-2 mb-3">
              <input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="colleague@example.com" className="flex-1 border border-slate-300 rounded-lg px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all" disabled={inviteLoading || !!inviteLink} />
              <button onClick={handleInviteSubmit} disabled={inviteLoading || !inviteEmail.trim() || !mapId || !!inviteLink} className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm">{inviteLoading ? '招待中...' : '招待する'}</button>
            </div>
            {!mapId && <p className="text-sm text-amber-600 mb-2 font-medium">⚠️ マップを保存してから招待してください。</p>}
            {inviteMessage && !inviteLink && <p className={`text-sm font-medium ${inviteMessage.includes('エラー') || inviteMessage.includes('保存') ? 'text-rose-500' : 'text-emerald-600'}`}>{inviteMessage}</p>}
            {inviteLink && (
              <div className="mt-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
                <p className="text-xs font-medium text-slate-700 mb-2">招待リンク（未登録ユーザー用）:</p>
                <div className="flex items-center gap-2">
                  <input readOnly value={inviteLink} className="flex-1 text-xs bg-white border border-slate-200 rounded px-2 py-1 outline-none" />
                  <button onClick={() => { navigator.clipboard.writeText(inviteLink); setInviteMessage('コピーしました！'); }} className="text-xs bg-indigo-100 text-indigo-700 px-3 py-1 rounded hover:bg-indigo-200 transition-colors">コピー</button>
                </div>
                <p className="text-[10px] text-slate-400 mt-1">相手がこのリンクを開いてログインすると、自動的にマップに参加できます。</p>
              </div>
            )}
          </div>
        </div>
      )}
      {showHelpModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm" onClick={() => setShowHelpModal(false)}>
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-2xl border border-slate-100 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4 border-b border-slate-100 pb-3">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2"><HelpIcon /> 操作コマンド一覧</h3>
              <button onClick={() => setShowHelpModal(false)} className="text-slate-400 hover:text-slate-600 transition-colors">&times;</button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h4 className="text-sm font-bold text-indigo-600 mb-3 uppercase tracking-wider">ノード操作</h4>
                <ul className="space-y-3 text-sm">
                  <li className="flex justify-between items-center"><span className="text-slate-600">子を追加</span><kbd className="px-2 py-1 bg-slate-100 border border-slate-200 rounded text-xs font-mono text-slate-700 shadow-sm">Tab</kbd></li>
                  <li className="flex justify-between items-center"><span className="text-slate-600">下に追加</span><kbd className="px-2 py-1 bg-slate-100 border border-slate-200 rounded text-xs font-mono text-slate-700 shadow-sm">Enter</kbd></li>
                  <li className="flex justify-between items-center"><span className="text-slate-600">上に追加</span><kbd className="px-2 py-1 bg-slate-100 border border-slate-200 rounded text-xs font-mono text-slate-700 shadow-sm">Shift + Enter</kbd></li>
                  <li className="flex justify-between items-center"><span className="text-slate-600">左(親)に追加</span><kbd className="px-2 py-1 bg-slate-100 border border-slate-200 rounded text-xs font-mono text-slate-700 shadow-sm">Ctrl/⌘ + Enter</kbd></li>
                  <li className="flex justify-between items-center"><span className="text-slate-600">削除</span><kbd className="px-2 py-1 bg-slate-100 border border-slate-200 rounded text-xs font-mono text-slate-700 shadow-sm">Delete / Backspace</kbd></li>
                  <li className="flex justify-between items-center"><span className="text-slate-600">テキスト編集</span><kbd className="px-2 py-1 bg-slate-100 border border-slate-200 rounded text-xs font-mono text-slate-700 shadow-sm">ダブルクリック</kbd></li>
                  <li className="flex justify-between items-center"><span className="text-slate-600">折りたたみ/展開</span><kbd className="px-2 py-1 bg-slate-100 border border-slate-200 rounded text-xs font-mono text-slate-700 shadow-sm">ノード左上のボタン</kbd></li>
                  <li className="flex justify-between items-center"><span className="text-slate-600">画像拡大表示</span><kbd className="px-2 py-1 bg-slate-100 border border-slate-200 rounded text-xs font-mono text-slate-700 shadow-sm">画像ノードをダブルクリック</kbd></li>
                </ul>
              </div>
              <div>
                <h4 className="text-sm font-bold text-indigo-600 mb-3 uppercase tracking-wider">キャンバス操作</h4>
                <ul className="space-y-3 text-sm">
                  <li className="flex justify-between items-center"><span className="text-slate-600">画面移動 (パン)</span><kbd className="px-2 py-1 bg-slate-100 border border-slate-200 rounded text-xs font-mono text-slate-700 shadow-sm">Space + ドラッグ</kbd></li>
                  <li className="flex justify-between items-center"><span className="text-slate-600">ズームイン/アウト</span><div className="flex gap-1"><kbd className="px-2 py-1 bg-slate-100 border border-slate-200 rounded text-xs font-mono text-slate-700 shadow-sm">Ctrl/⌘ + Wheel</kbd></div></li>
                  <li className="flex justify-between items-center"><span className="text-slate-600">全体表示に戻る</span><kbd className="px-2 py-1 bg-slate-100 border border-slate-200 rounded text-xs font-mono text-slate-700 shadow-sm">Homeボタン</kbd></li>
                  <li className="flex justify-between items-center"><span className="text-slate-600">範囲選択</span><kbd className="px-2 py-1 bg-slate-100 border border-slate-200 rounded text-xs font-mono text-slate-700 shadow-sm">背景をドラッグ</kbd></li>
                  <li className="flex justify-between items-center"><span className="text-slate-600">線を引く</span><kbd className="px-2 py-1 bg-slate-100 border border-slate-200 rounded text-xs font-mono text-slate-700 shadow-sm">〇をドラッグ</kbd></li>
                  <li className="flex justify-between items-center"><span className="text-slate-600">図形/テキスト配置</span><kbd className="px-2 py-1 bg-slate-100 border border-slate-200 rounded text-xs font-mono text-slate-700 shadow-sm">ツール選択後クリック</kbd></li>
                </ul>
              </div>
              <div className="md:col-span-2 pt-4 border-t border-slate-100">
                <h4 className="text-sm font-bold text-indigo-600 mb-3 uppercase tracking-wider">システム・グループ・その他</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <ul className="space-y-3 text-sm">
                    <li className="flex justify-between items-center"><span className="text-slate-600">複数選択</span><kbd className="px-2 py-1 bg-slate-100 border border-slate-200 rounded text-xs font-mono text-slate-700 shadow-sm">Ctrl/⌘ + クリック</kbd></li>
                    <li className="flex justify-between items-center"><span className="text-slate-600">レイヤー変更</span><kbd className="px-2 py-1 bg-slate-100 border border-slate-200 rounded text-xs font-mono text-slate-700 shadow-sm">右クリックメニュー</kbd></li>
                    <li className="flex justify-between items-center"><span className="text-slate-600">画像ドロップ</span><kbd className="px-2 py-1 bg-slate-100 border border-slate-200 rounded text-xs font-mono text-slate-700 shadow-sm">画像を直接ドラッグ</kbd></li>
                    <li className="flex justify-between items-center"><span className="text-slate-600">印鑑を配置</span><kbd className="px-2 py-1 bg-slate-100 border border-slate-200 rounded text-xs font-mono text-slate-700 shadow-sm">Ctrl/Cmd + Shift + S</kbd></li>
                    <li className="flex justify-between items-center"><span className="text-slate-600">テキスト図形の文字サイズ</span><kbd className="px-2 py-1 bg-slate-100 border border-slate-200 rounded text-xs font-mono text-slate-700 shadow-sm">選択中にサイズメニュー</kbd></li>
                  </ul>
                  <ul className="space-y-3 text-sm">
                    <li className="flex justify-between items-center"><span className="text-slate-600">保存</span><kbd className="px-2 py-1 bg-slate-100 border border-slate-200 rounded text-xs font-mono text-slate-700 shadow-sm">Ctrl/⌘ + S</kbd></li>
                    <li className="flex justify-between items-center"><span className="text-slate-600">元に戻す</span><kbd className="px-2 py-1 bg-slate-100 border border-slate-200 rounded text-xs font-mono text-slate-700 shadow-sm">Ctrl/⌘ + Z</kbd></li>
                    <li className="flex justify-between items-center"><span className="text-slate-600">全画面表示 (Zen)</span><kbd className="px-2 py-1 bg-slate-100 border border-slate-200 rounded text-xs font-mono text-slate-700 shadow-sm">Alt + Cmd + F</kbd></li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="w-[280px] flex-shrink-0 h-full bg-white border-r border-slate-200 shadow-sm z-[100] flex flex-col relative">
        <div className="p-4 border-b border-slate-100 flex flex-col gap-3 bg-white">
          <div className="flex items-center justify-between">
            <h2 className="font-extrabold text-slate-800 tracking-tight flex items-center gap-2">
              <svg className="w-6 h-6 text-indigo-600 drop-shadow-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="3" strokeWidth="2.5" fill="#e0e7ff"/><circle cx="6" cy="6" r="2" strokeWidth="2.5"/><circle cx="18" cy="6" r="2" strokeWidth="2.5"/><circle cx="6" cy="18" r="2" strokeWidth="2.5"/><circle cx="18" cy="18" r="2" strokeWidth="2.5"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8.5 8.5L10.5 10.5M15.5 8.5L13.5 10.5M8.5 15.5L10.5 13.5M15.5 15.5L13.5 13.5"/></svg>
              MindMap Pro
            </h2>
            <div className="flex items-center gap-1.5 px-2 py-1 bg-slate-50 rounded border border-slate-200" title={connectionStatus}>
              <div className={`w-2 h-2 rounded-full ${statusColor} ${connectionStatus === '接続済み' ? 'animate-pulse' : ''}`} />
              <span className="text-[10px] font-medium text-slate-500">{connectionStatus === '接続済み' ? 'Online' : 'Offline'}</span>
            </div>
          </div>
        </div>
        <div className="p-4 border-b border-slate-100 flex flex-col gap-3">
          <button onClick={handleNewMap} className="flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white py-2.5 rounded-lg shadow-sm w-full font-medium transition-colors"><PlusIcon /> 新規マップ作成</button>
          <div className="flex gap-2">
            <button onClick={handleSave} className="flex-1 flex items-center justify-center gap-1.5 bg-white border border-slate-200 hover:bg-slate-50 py-2 rounded-lg text-sm font-medium text-slate-700 transition-colors shadow-sm"><SaveIcon /> 保存</button>
            <button onClick={handleShare} disabled={!canShare} className="flex-1 flex items-center justify-center gap-1.5 bg-white border border-slate-200 hover:bg-slate-50 py-2 rounded-lg text-sm font-medium text-slate-700 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"><LinkIcon /> 共有</button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-3 bg-slate-50/50">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 px-1">Recent Maps</h3>
          {savedMaps.length === 0 ? (
            <div className="text-sm text-slate-400 text-center py-8 bg-white border border-slate-100 rounded-lg border-dashed">まだマップがありません</div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {savedMaps.map((map: MapRecord, index: number) => (
                <div key={map.id} draggable onDragStart={(e) => handleMapDragStart(e, index)} onDragEnter={(e) => handleMapDragEnter(e, index)} onDragEnd={handleMapDragEnd} onDragOver={(e) => e.preventDefault()} className={`group flex flex-col rounded-lg border transition-all cursor-grab active:cursor-grabbing ${mapId === map.id ? 'bg-indigo-50 border-indigo-200 shadow-sm' : 'bg-white border-transparent hover:border-slate-200 hover:shadow-sm'}`}>
                  {editingMapId === map.id ? (
                    <div className="px-3 py-2.5 bg-white rounded-t-lg flex items-center gap-2">
                      <GripVerticalIcon />
                      <input autoFocus value={editMapTitle} onChange={e => setEditMapTitle(e.target.value)} onBlur={() => handleSaveTitleOnly(map.id, editMapTitle)} onKeyDown={e => { if (e.key === 'Enter') handleSaveTitleOnly(map.id, editMapTitle); if (e.key === 'Escape') setEditingMapId(null); }} className="w-full text-sm font-semibold text-indigo-900 bg-transparent border-b-2 border-indigo-500 outline-none pb-0.5" />
                    </div>
                  ) : (
                    <div className="flex items-center justify-between w-full relative overflow-hidden">
                      <div className="pl-2 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"><GripVerticalIcon /></div>
                      <button onClick={() => handleLoadMap(map)} className={`flex-1 text-left px-2 py-2.5 rounded-t-lg text-sm transition-colors truncate ${mapId === map.id ? 'text-indigo-900 font-semibold' : 'text-slate-700 font-medium'}`}>{map.title}</button>
                      <button onClick={(e) => { e.stopPropagation(); setEditMapTitle(map.title); setEditingMapId(map.id); }} className={`absolute right-2 p-1.5 opacity-0 group-hover:opacity-100 bg-slate-100/80 hover:bg-slate-200 rounded text-slate-500 hover:text-indigo-600 transition-all ${mapId === map.id ? 'opacity-100' : ''}`} title="タイトルを変更"><PencilIcon /></button>
                    </div>
                  )}
                  <div className="flex flex-col px-3 pb-2.5 pt-1 cursor-default">
                    <div className="flex items-center justify-between w-full">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-500" title={map.user_id === user.id ? undefined : `オーナー: ${map.owner_email || '不明'}`}>
                          {map.user_id === user.id ? '👑 オーナー' : '🤝 共有'}
                        </span>
                        <div className={`flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity ${mapId === map.id ? 'opacity-100' : ''}`}>
                          <button onClick={(e) => { e.stopPropagation(); handleCopyMap(map, e); }} className="p-1.5 hover:bg-slate-200 rounded text-slate-500 hover:text-slate-700 transition-colors" title="コピー"><CopyIcon /></button>
                          {map.user_id === user.id ? (
                            <button onClick={(e) => { e.stopPropagation(); handleDeleteMap(map, e); }} className="p-1.5 hover:bg-rose-100 rounded text-slate-500 hover:text-rose-600 transition-colors" title="削除"><TrashIcon /></button>
                          ) : (
                            <button onClick={(e) => { e.stopPropagation(); handleLeaveMap(map, e); }} className="p-1.5 hover:bg-amber-100 rounded text-slate-500 hover:text-amber-600 transition-colors" title="退出"><LeaveIcon /></button>
                          )}
                        </div>
                      </div>
                      <span className="text-[10px] text-slate-400">{map.updated_at ? new Date(map.updated_at).toLocaleString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}</span>
                    </div>
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

      <div className="flex-1 relative flex flex-col min-w-0 bg-slate-50 overflow-hidden">
        {!zenMode && (
          <>
            <div className="absolute top-4 left-4 z-40 flex items-center gap-2 bg-white/90 backdrop-blur-md border border-slate-200/60 p-1.5 rounded-xl shadow-sm">
              <input value={mapTitle} onChange={e => setMapTitle(e.target.value)} onBlur={handleHeaderTitleBlur} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} className="border border-transparent hover:border-slate-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 bg-transparent hover:bg-slate-50 focus:bg-white px-3 py-1.5 text-sm w-48 font-bold outline-none rounded-md transition-all text-slate-800" placeholder="NEW" />
              <div className="w-px h-5 bg-slate-200 mx-1" />
              <button onClick={handleUndo} disabled={!canUndo} className="p-1.5 rounded-lg hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent text-slate-600 transition-colors" title="元に戻す (Ctrl+Z)"><UndoIcon /></button>
              <button onClick={handleRedo} disabled={!canRedo} className="p-1.5 rounded-lg hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent text-slate-600 transition-colors" title="やり直し (Ctrl+Shift+Z)"><RedoIcon /></button>
              <div className="w-px h-5 bg-slate-200 mx-1" />
              <div className="flex items-center pr-2 gap-1.5">
                {isDirty && <span className="text-[10px] font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></div>未保存</span>}
                {saveMessage === '保存完了' && <span className="text-[10px] font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>保存済み</span>}
              </div>
            </div>
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-1 bg-white/95 backdrop-blur-md border border-slate-200/60 p-1.5 rounded-xl shadow-sm">
              <button onClick={() => setCurrentTool('select')} className={`p-2 rounded-lg transition-colors ${currentTool === 'select' ? 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200' : 'hover:bg-slate-100 text-slate-600'}`} title="選択ツール"><CursorIcon /></button>
              <div className="w-px h-6 bg-slate-200 mx-0.5" />
              <button onClick={() => setCurrentTool('rectangle')} className={`p-2 rounded-lg transition-colors ${currentTool === 'rectangle' ? 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200' : 'hover:bg-slate-100 text-slate-600'}`} title="四角形ツール"><SquareIcon /></button>
              <button onClick={() => setCurrentTool('circle')} className={`p-2 rounded-lg transition-colors ${currentTool === 'circle' ? 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200' : 'hover:bg-slate-100 text-slate-600'}`} title="円形ツール"><CircleIcon /></button>
              <button onClick={() => setCurrentTool('triangle')} className={`p-2 rounded-lg transition-colors ${currentTool === 'triangle' ? 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200' : 'hover:bg-slate-100 text-slate-600'}`} title="三角形ツール"><TriangleIcon /></button>
              <button onClick={() => setCurrentTool('text')} className={`p-2 rounded-lg transition-colors ${currentTool === 'text' ? 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200' : 'hover:bg-slate-100 text-slate-600'}`} title="テキストツール"><TextOutlineIcon /></button>
              <div className="w-px h-6 bg-slate-200 mx-0.5" />
              <button onClick={handleHeaderAddSticky} className="p-2 rounded-lg hover:bg-slate-100 text-amber-600 transition-colors" title="付箋を追加"><StickyIcon /></button>
              <button onClick={() => fileInputRef.current?.click()} className="p-2 rounded-lg hover:bg-slate-100 text-sky-600 transition-colors" title="画像を添付（自由配置）"><ImageIcon /></button>
              <button onClick={() => { const container = scrollContainerRef.current; if (container) { const x = (container.scrollLeft + container.clientWidth / 2) / zoomLevel; const y = (container.scrollTop + container.clientHeight / 2) / zoomLevel; addImageNodeWithUpload(x, y); } }} className="p-2 rounded-lg hover:bg-slate-100 text-purple-600 transition-colors" title="画像専用ノードを追加"><ImageNodeIcon /></button>
              <div className="w-px h-6 bg-slate-200 mx-0.5" />
              <div className="flex items-center gap-1 bg-rose-50/50 p-1 rounded-lg border border-rose-100">
                <input type="text" value={stampText} onChange={e => setStampText(e.target.value.slice(0, 8))} className="text-[11px] w-16 bg-transparent border-none focus:ring-0 text-rose-700 font-bold px-1 text-center outline-none placeholder-rose-300" placeholder="印鑑名" title="印鑑名" />
                <div className="w-px h-4 bg-rose-200" />
                <button onClick={() => { const container = scrollContainerRef.current; if (container) { const x = (container.scrollLeft + container.clientWidth / 2) / zoomLevel; const y = (container.scrollTop + container.clientHeight / 2) / zoomLevel; addStamp(x, y); } }} className="p-1.5 rounded hover:bg-rose-100 text-rose-600 transition-colors" title="印鑑を配置 (Ctrl+Shift+S)"><StampIcon /></button>
              </div>
              <div className="w-px h-6 bg-slate-200 mx-1" />
              <div className="flex items-center gap-1">
                {COLOR_PALETTE.map(cp => (<button key={cp.label} onClick={() => handleHeaderColorSelect(cp.bg, cp.text)} disabled={totalSelectedCount === 0} className="w-5 h-5 rounded-full border border-slate-300 hover:scale-110 transition-transform disabled:opacity-30 disabled:cursor-not-allowed shadow-sm" style={{ backgroundColor: cp.bg }} title={cp.label} />))}
              </div>
              <div className="w-px h-6 bg-slate-200 mx-1" />
              <select value={edgeStyle} onChange={e => handleEdgeStyleChange(e.target.value as EdgeStyle)} className="text-[11px] border border-slate-200 bg-slate-50 hover:bg-slate-100 rounded-md px-2 py-1.5 outline-none focus:ring-1 focus:ring-indigo-500 text-slate-700 cursor-pointer shadow-sm transition-colors font-medium">
                <option value="bezier">曲線</option>
                <option value="step">直角</option>
                <option value="straight">直線</option>
              </select>
            </div>
            <div className="absolute top-4 right-4 z-40 flex items-center">
              <div className="relative bg-white/90 backdrop-blur-md border border-slate-200/60 p-1.5 rounded-xl shadow-sm">
                <button onClick={() => setShowParticipants(!showParticipants)} className="flex items-center gap-1 hover:bg-slate-100 rounded-lg px-2 py-1 transition-colors" title="参加者一覧">
                  <div className="flex flex-wrap -space-x-2 max-w-[200px]">
                    {allParticipants.map((p) => (
                      <div key={p.user_id} className="relative">
                        <div className={`w-8 h-8 rounded-full border-2 border-white flex items-center justify-center text-xs font-bold text-white shadow-sm ${p.isSelf ? 'ring-2 ring-indigo-400 z-10' : ''} ${!p.isOnline ? 'opacity-50 grayscale' : ''}`} style={{ backgroundColor: p.color }} title={p.email}>{getInitial(p.email)}</div>
                        <div className={`absolute -bottom-0.5 right-0 w-2.5 h-2.5 rounded-full border border-white ${p.isOnline ? 'bg-emerald-400' : 'bg-slate-300'}`}></div>
                      </div>
                    ))}
                  </div>
                </button>
                {showParticipants && (
                  <div className="absolute top-full right-0 mt-3 w-64 bg-white border border-slate-200 rounded-xl shadow-2xl p-4 z-50">
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
                            <div className="text-slate-400 text-[10px] mt-0.5">{p.isOnline ? (p.editingNodeId ? '📝 編集中...' : p.selectedNodeId ? '👆 ノード選択中' : '🟢 オンライン') : '⚫ オフライン'}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <button onClick={() => setShowParticipants(false)} className="mt-4 text-xs font-medium text-slate-500 hover:text-slate-700 w-full text-center py-2 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200 transition-colors">閉じる</button>
                  </div>
                )}
              </div>
            </div>
            <div className="absolute bottom-4 right-4 z-40 flex flex-col items-end gap-2">
              <div className="flex items-center gap-1 bg-white/90 backdrop-blur-md border border-slate-200/60 p-1.5 rounded-xl shadow-sm">
                <button onClick={() => setShowHelpModal(true)} className="p-2 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors" title="ショートカット一覧"><HelpIcon /></button>
                <div className="w-px h-5 bg-slate-200 mx-0.5" />
                <button onClick={scrollToHome} className="p-2 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors" title="ホーム位置に戻る"><HomeIcon /></button>
                <div className="w-px h-5 bg-slate-200 mx-0.5" />
                <button onClick={() => changeZoom(-0.1)} className="p-2 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors" title="縮小">−</button>
                <span className="text-xs text-slate-600 font-semibold w-12 text-center cursor-pointer select-none" onClick={() => setZoomLevel(1.0)} title="100%に戻す">{Math.round(zoomLevel * 100)}%</span>
                <button onClick={() => changeZoom(0.1)} className="p-2 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors" title="拡大">＋</button>
                <div className="w-px h-5 bg-slate-200 mx-0.5" />
                <button onClick={toggleGrid} className={`p-2 rounded-lg transition-colors ${showGrid ? 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200' : 'hover:bg-slate-100 text-slate-600'}`} title="背景グリッドの表示/非表示"><GridIcon /></button>
              </div>
            </div>
          </>
        )}
        {zenMode && <button onClick={() => setZenMode(false)} className="absolute top-4 right-4 z-50 bg-slate-900/80 backdrop-blur text-white border border-slate-700 rounded-full px-5 py-2 text-xs font-bold shadow-2xl hover:bg-slate-800 transition-all transform hover:scale-105">ZEN解除 (Alt+Cmd+F)</button>}
        {contextMenu.visible && !showColorPalette && (
          <div className="fixed z-[100] bg-white border border-slate-200 rounded-xl shadow-2xl py-1.5 text-sm min-w-[200px]" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={e => e.stopPropagation()}>
            {contextMenu.type === 'node' && contextMenu.nodeId && (<><button onClick={() => executeContextAction('addChild')} className="w-full text-left px-4 py-2.5 hover:bg-indigo-50 hover:text-indigo-700 font-medium flex items-center justify-between group transition-colors"><span>右に追加</span><span className="text-[10px] text-slate-400 group-hover:text-indigo-400 border border-slate-200 group-hover:border-indigo-200 rounded px-1">Tab</span></button><button onClick={() => executeContextAction('addSiblingAfter')} className="w-full text-left px-4 py-2.5 hover:bg-indigo-50 hover:text-indigo-700 font-medium flex items-center justify-between group transition-colors"><span>下に追加</span><span className="text-[10px] text-slate-400 group-hover:text-indigo-400 border border-slate-200 group-hover:border-indigo-200 rounded px-1">Enter</span></button><button onClick={() => executeContextAction('addSiblingBefore')} className="w-full text-left px-4 py-2.5 hover:bg-indigo-50 hover:text-indigo-700 font-medium flex items-center justify-between group transition-colors"><span>上に追加</span><span className="text-[10px] text-slate-400 group-hover:text-indigo-400 border border-slate-200 group-hover:border-indigo-200 rounded px-1">⇧Enter</span></button><button onClick={() => executeContextAction('addParent')} className="w-full text-left px-4 py-2.5 hover:bg-indigo-50 hover:text-indigo-700 font-medium flex items-center justify-between group transition-colors"><span>左に追加</span><span className="text-[10px] text-slate-400 group-hover:text-indigo-400 border border-slate-200 group-hover:border-indigo-200 rounded px-1">⌘Enter</span></button><div className="mx-2 my-1 border-b border-slate-100" /><button onClick={() => executeContextAction('toggleCollapse')} className="w-full text-left px-4 py-2.5 hover:bg-slate-50 font-medium text-slate-700 transition-colors">折りたたみ/展開</button><div className="mx-2 my-1 border-b border-slate-100" /><button onClick={() => { setShowColorPalette({ nodeId: contextMenu.nodeId!, x: contextMenu.x, y: contextMenu.y }); setContextMenu(prev => ({ ...prev, visible: false })); }} className="w-full text-left px-4 py-2.5 hover:bg-slate-50 font-medium text-slate-700 transition-colors">色を変更</button><div className="mx-2 my-1 border-b border-slate-100" />{selectedNodeIds.length >= 2 && (<><button onClick={() => executeContextAction('alignVertical')} className="w-full text-left px-4 py-2.5 hover:bg-slate-50 font-medium text-slate-700 transition-colors">垂直に整列</button><button onClick={() => executeContextAction('alignHorizontal')} className="w-full text-left px-4 py-2.5 hover:bg-slate-50 font-medium text-slate-700 transition-colors">水平に整列</button><div className="mx-2 my-1 border-b border-slate-100" /></>)}<button onClick={() => executeContextAction('bringToFront')} className="w-full text-left px-4 py-2.5 hover:bg-slate-50 font-medium text-slate-700 transition-colors">最前面へ移動</button><button onClick={() => executeContextAction('sendToBack')} className="w-full text-left px-4 py-2.5 hover:bg-slate-50 font-medium text-slate-700 transition-colors">最背面へ移動</button><div className="mx-2 my-1 border-b border-slate-100" /><button onClick={() => executeContextAction('delete')} className="w-full text-left px-4 py-2.5 hover:bg-rose-50 text-rose-600 font-medium flex items-center justify-between group transition-colors"><span>削除</span><span className="text-[10px] text-rose-300 group-hover:text-rose-500 border border-rose-100 group-hover:border-rose-200 rounded px-1">⌫</span></button></>)}
            {contextMenu.type === 'edge' && (<><button onClick={() => executeContextAction('deleteEdge')} className="w-full text-left px-4 py-2.5 hover:bg-rose-50 text-rose-600 font-medium flex items-center justify-between group transition-colors"><span>線を削除</span><span className="text-[10px] text-rose-300 border border-rose-100 rounded px-1 group-hover:border-rose-200 group-hover:text-rose-500">⌫</span></button><div className="mx-2 my-1 border-b border-slate-100" /><div className="px-4 py-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">矢印の向き</div><button onClick={() => executeContextAction('arrowNone')} className="w-full text-left px-4 py-2 hover:bg-slate-50 font-medium text-slate-700 transition-colors">なし</button><button onClick={() => executeContextAction('arrowStart')} className="w-full text-left px-4 py-2 hover:bg-slate-50 font-medium text-slate-700 transition-colors">始点 →</button><button onClick={() => executeContextAction('arrowEnd')} className="w-full text-left px-4 py-2 hover:bg-slate-50 font-medium text-slate-700 transition-colors">終点 →</button><button onClick={() => executeContextAction('arrowBoth')} className="w-full text-left px-4 py-2 hover:bg-slate-50 font-medium text-slate-700 transition-colors">両方 ⇄</button></>)}
            {contextMenu.type === 'image' && contextMenu.imageId && (<><button onClick={() => executeContextAction('bringToFront')} className="w-full text-left px-4 py-2.5 hover:bg-slate-50 font-medium text-slate-700 transition-colors">最前面へ移動</button><button onClick={() => executeContextAction('sendToBack')} className="w-full text-left px-4 py-2.5 hover:bg-slate-50 font-medium text-slate-700 transition-colors">最背面へ移動</button><div className="mx-2 my-1 border-b border-slate-100" /><button onClick={() => executeContextAction('deleteImage')} className="w-full text-left px-4 py-2.5 hover:bg-rose-50 text-rose-600 font-medium transition-colors">画像を削除</button></>)}
            {contextMenu.type === 'sticky' && contextMenu.stickyId && (<><button onClick={() => executeContextAction('changeColor')} className="w-full text-left px-4 py-2.5 hover:bg-slate-50 font-medium text-slate-700 transition-colors">色を変更</button><button onClick={() => executeContextAction('bringToFront')} className="w-full text-left px-4 py-2.5 hover:bg-slate-50 font-medium text-slate-700 transition-colors">最前面へ移動</button><button onClick={() => executeContextAction('sendToBack')} className="w-full text-left px-4 py-2.5 hover:bg-slate-50 font-medium text-slate-700 transition-colors">最背面へ移動</button><div className="mx-2 my-1 border-b border-slate-100" /><button onClick={() => executeContextAction('deleteSticky')} className="w-full text-left px-4 py-2.5 hover:bg-rose-50 text-rose-600 font-medium transition-colors">付箋を削除</button></>)}
            {contextMenu.type === 'outline' && contextMenu.outlineId && (<><button onClick={() => executeContextAction('changeColor')} className="w-full text-left px-4 py-2.5 hover:bg-slate-50 font-medium text-slate-700 transition-colors">色を変更</button><button onClick={() => executeContextAction('bringToFront')} className="w-full text-left px-4 py-2.5 hover:bg-slate-50 font-medium text-slate-700 transition-colors">最前面へ移動</button><button onClick={() => executeContextAction('sendToBack')} className="w-full text-left px-4 py-2.5 hover:bg-slate-50 font-medium text-slate-700 transition-colors">最背面へ移動</button><div className="mx-2 my-1 border-b border-slate-100" /><button onClick={() => executeContextAction('deleteOutline')} className="w-full text-left px-4 py-2.5 hover:bg-rose-50 text-rose-600 font-medium transition-colors">図形/テキストを削除</button></>)}
            {contextMenu.type === 'stamp' && contextMenu.stampId && (<><button onClick={() => executeContextAction('changeColor')} className="w-full text-left px-4 py-2.5 hover:bg-slate-50 font-medium text-slate-700 transition-colors">色を変更</button><button onClick={() => executeContextAction('bringToFront')} className="w-full text-left px-4 py-2.5 hover:bg-slate-50 font-medium text-slate-700 transition-colors">最前面へ移動</button><button onClick={() => executeContextAction('sendToBack')} className="w-full text-left px-4 py-2.5 hover:bg-slate-50 font-medium text-slate-700 transition-colors">最背面へ移動</button><div className="mx-2 my-1 border-b border-slate-100" /><button onClick={() => executeContextAction('deleteStamp')} className="w-full text-left px-4 py-2.5 hover:bg-rose-50 text-rose-600 font-medium transition-colors">印鑑を削除</button></>)}
            {contextMenu.type === 'canvas' && (<><button onClick={() => executeContextAction('addNode')} className="w-full text-left px-4 py-2.5 hover:bg-slate-50 font-medium text-slate-700 transition-colors">独立トピックを追加</button><button onClick={() => executeContextAction('addImageNode')} className="w-full text-left px-4 py-2.5 hover:bg-slate-50 font-medium text-slate-700 transition-colors">画像専用ノードを追加</button><button onClick={() => executeContextAction('addSticky')} className="w-full text-left px-4 py-2.5 hover:bg-slate-50 font-medium text-slate-700 transition-colors">付箋を追加</button><button onClick={() => executeContextAction('addStamp')} className="w-full text-left px-4 py-2.5 hover:bg-slate-50 font-medium text-slate-700 transition-colors">印鑑を追加</button><button onClick={() => executeContextAction('addImage')} className="w-full text-left px-4 py-2.5 hover:bg-slate-50 font-medium text-slate-700 transition-colors">画像を添付（自由配置）</button></>)}
          </div>
        )}
        {showColorPalette && (
          <div className="fixed z-[110] bg-white border border-slate-200 rounded-xl shadow-2xl p-4 text-sm" style={{ left: showColorPalette.x, top: showColorPalette.y }} onClick={e => e.stopPropagation()}>
            <div className="text-xs font-bold text-slate-500 mb-3 text-center uppercase tracking-wide">カラーパレット</div>
            <div className="grid grid-cols-4 gap-3 mb-4">{COLOR_PALETTE.map((cp: { bg: string; text: string; label: string }, idx: number) => (<button key={idx} className="w-10 h-10 rounded-full border border-slate-200 hover:scale-110 transition-transform shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500" style={{ backgroundColor: cp.bg, boxShadow: `inset 0 0 0 1px rgba(0,0,0,0.05), 0 0 0 2px ${cp.text}` }} title={cp.label} onClick={() => { if(showColorPalette.nodeId && selectedNodeIds.length > 1) updateMultipleNodeColors(selectedNodeIds, cp.bg, cp.text); else if(showColorPalette.nodeId) updateNodeColors(showColorPalette.nodeId, cp.bg, cp.text); else if(showColorPalette.stickyId) updateStickyColors(showColorPalette.stickyId, cp.bg, cp.text); else if(showColorPalette.outlineId) updateOutlineColor(showColorPalette.outlineId, cp.text); setShowColorPalette(null); closeContextMenu(); }} />))}</div>
            <button onClick={() => setShowColorPalette(null)} className="w-full py-2.5 text-xs font-bold text-slate-600 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors">キャンセル</button>
          </div>
        )}
        <div ref={scrollContainerRef} className={`${canvasScrollClass} hide-scrollbar bg-slate-50`} tabIndex={0} onKeyDown={handleKeyDown} onClick={handleCanvasClick} onContextMenu={handleCanvasContextMenu} onMouseDown={handleCanvasMouseDown} onDoubleClick={handleCanvasDoubleClick} onDragOver={(e) => e.preventDefault()} onDrop={handleCanvasDrop} style={hideScrollbarStyle as React.CSSProperties}>
          <div className="relative" style={{ width: '10000px', height: '10000px', transform: `scale(${zoomLevel})`, transformOrigin: '0 0', backgroundImage: showGrid ? 'radial-gradient(circle, rgba(148,163,184,0.3) 1.5px, transparent 1.5px)' : 'none', backgroundSize: '32px 32px', backgroundColor: '#f8fafc' }} onContextMenu={handleCanvasContextMenu}>
            {remoteCursors.map((p) => (
              <div key={p.user_id} className="absolute pointer-events-none" style={{ left: p.cursorX!, top: p.cursorY!, zIndex: 9999 }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill={p.color} stroke="white" strokeWidth="1.5">
                  <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
                </svg>
                <span className="ml-5 text-xs font-bold px-1.5 py-0.5 rounded text-white shadow" style={{ backgroundColor: p.color }}>{getInitial(p.email)}</span>
              </div>
            ))}
            {showFloatingToolbar && floatingToolbarPos && (
              <div className="absolute z-[60] bg-slate-800 rounded-lg shadow-xl border border-slate-700 flex items-center p-1.5 gap-1.5" style={{ left: floatingToolbarPos.x, top: floatingToolbarPos.y - floatingToolbarPos.height / 2 - 50, transform: 'translate(-50%, 0)', animation: 'fadeIn 0.15s ease-out' }} onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}>
                <style>{`@keyframes fadeIn { from { opacity: 0; transform: translate(-50%, 8px); } to { opacity: 1; transform: translate(-50%, 0); } }`}</style>
                <button onClick={() => setShowColorPalette({ nodeId: selectedNodeId!, x: window.innerWidth / 2, y: window.innerHeight / 2 })} className="p-1.5 hover:bg-slate-700 rounded-md text-slate-300 hover:text-white transition-colors" title="色を変更"><PaletteIcon /></button>
                <div className="w-px h-5 bg-slate-600 mx-0.5" />
                <button onClick={() => addChildNode(selectedNodeId!)} className="p-1.5 hover:bg-indigo-900/50 rounded-md text-indigo-300 hover:text-indigo-200 flex items-center gap-1 transition-colors" title="右に追加 (Tab)"><SubNodeIcon /><span className="text-[10px] font-bold">右</span></button>
                <button onClick={() => addSiblingNode(selectedNodeId!, 'after')} className="p-1.5 hover:bg-indigo-900/50 rounded-md text-indigo-300 hover:text-indigo-200 flex items-center gap-1 transition-colors" title="下に追加 (Enter)"><SiblingNodeIcon /><span className="text-[10px] font-bold">下</span></button>
                <div className="w-px h-5 bg-slate-600 mx-0.5" />
                <button onClick={() => deleteNode(selectedNodeId!)} className="p-1.5 hover:bg-rose-900/50 rounded-md text-rose-400 hover:text-rose-300 transition-colors" title="削除 (Delete/Backspace)"><TrashIcon /></button>
                <div className="w-px h-5 bg-slate-600 mx-0.5" />
                {selectedNodeId !== yRootRef.current && (
                  <button onClick={() => toggleNodeCollapse(selectedNodeId!)} className="p-1.5 hover:bg-slate-700 rounded-md text-slate-300 hover:text-white transition-colors" title="折りたたみ/展開">
                    {mindMap && findNodeById(mindMap, selectedNodeId!)?.collapsed ? <ExpandIcon /> : <CollapseIcon />}
                  </button>
                )}
                {selectedOutlineId && outlines.find(o => o.id === selectedOutlineId)?.type === 'text' && (
                  <div className="relative group">
                    <button className="p-1.5 hover:bg-slate-700 rounded-md text-slate-300" title="文字サイズ"><span className="text-xs">Aa</span></button>
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:flex flex-col bg-slate-800 rounded-lg p-1 z-50">
                      {FONT_SIZES.map(size => (<button key={size} onClick={() => updateOutlineFontSize(selectedOutlineId, size)} className="px-2 py-0.5 text-xs text-slate-300 hover:bg-slate-700 rounded">{size}px</button>))}
                    </div>
                  </div>
                )}
                {mindMap && findNodeById(mindMap, selectedNodeId!)?.imageUrl && (
                  <>
                    <div className="w-px h-5 bg-slate-600 mx-0.5" />
                    <div className="relative group">
                      <button className="p-1.5 hover:bg-slate-700 rounded-md text-slate-300 hover:text-white transition-colors" title="サイズ変更"><ResizeIcon /></button>
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:flex flex-col bg-slate-800 rounded-lg shadow-xl border border-slate-700 p-1 z-50 whitespace-nowrap">
                        {IMAGE_SCALE_PRESETS.map(scale => { const percent = Math.round(scale * 100); return (<button key={scale} onClick={() => resizeImageNode(selectedNodeId!, scale)} className="px-3 py-1 text-xs text-slate-300 hover:bg-slate-700 rounded transition-colors">{percent}%</button>); })}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
            {outlines.map((outline: OutlineData) => {
              const isEditing = editingOutlineId === outline.id;
              const isSelected = selectedOutlineIds.includes(outline.id);
              const fontSize = outline.fontSize ?? NODE_DEFAULT_FONT_SIZE;
              return (
                <div key={outline.id} className={`absolute cursor-move transition-shadow group ${isSelected ? 'ring-2 ring-indigo-500/50 shadow-md' : 'hover:ring-2 hover:ring-slate-300/50'} ${outline.type === 'text' ? '' : 'bg-transparent'}`} style={{ left: outline.x, top: outline.y, width: outline.width, height: outline.height, zIndex: outline.zIndex ?? 4, borderRadius: outline.type === 'circle' ? '50%' : '0' }} onMouseDown={(e) => handleMouseDownOnOutline(e as ReactMouseEvent, outline.id)} onContextMenu={(e) => handleOutlineContextMenu(e as ReactMouseEvent, outline.id)} onDoubleClick={(e) => { e.stopPropagation(); if (outline.type === 'text') setEditingOutlineId(outline.id); }} onClick={(e) => handleOutlineClick(e as ReactMouseEvent, outline.id)}>
                  {outline.type === 'rectangle' && (<div className="w-full h-full border-4 rounded" style={{ borderColor: outline.color }}></div>)}
                  {outline.type === 'circle' && (<div className="w-full h-full border-4 rounded-full" style={{ borderColor: outline.color }}></div>)}
                  {outline.type === 'triangle' && (<svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 pointer-events-none"><polygon points="50,0 100,100 0,100" fill="none" stroke={outline.color} strokeWidth="4" vectorEffect="non-scaling-stroke" /></svg>)}
                  {outline.type === 'text' && (
                    <div className="w-full h-full flex items-start">
                      {isEditing ? (
                        <textarea autoFocus className="w-full h-full resize-none bg-transparent border-none outline-none font-bold text-lg pointer-events-auto" style={{ color: outline.color, fontSize }} defaultValue={outline.text} onBlur={(e) => { const trimmed = e.currentTarget.value.trim(); updateOutlineText(outline.id, trimmed || 'テキスト'); setEditingOutlineId(null); }} onKeyDown={(e) => { if (e.key === 'Escape') setEditingOutlineId(null); }} onMouseDown={(e) => e.stopPropagation()} />
                      ) : (
                        <div className="w-full h-full whitespace-pre-wrap overflow-auto font-bold text-lg cursor-text select-none pointer-events-none" style={{ color: outline.color, fontSize }}>{outline.text}</div>
                      )}
                    </div>
                  )}
                  {isSelected && outline.type !== 'text' && selectedOutlineIds.length === 1 && totalSelectedCount === 1 && (
                    <div className="absolute top-2 right-2 flex gap-1 pointer-events-auto">
                      <button onClick={(e) => { e.stopPropagation(); setShowColorPalette({ outlineId: outline.id, x: window.innerWidth / 2, y: window.innerHeight / 2 }); }} className="p-1 hover:bg-slate-200/50 rounded text-slate-500"><PaletteIcon /></button>
                    </div>
                  )}
                  {isSelected && selectedOutlineIds.length === 1 && totalSelectedCount === 1 && (<>
                    <div className="absolute -top-1.5 -left-1.5 w-3 h-3 bg-white border-2 border-indigo-600 rounded-full cursor-nw-resize shadow-sm" onMouseDown={(e) => handleOutlineResizeHandleMouseDown(e as ReactMouseEvent, outline.id, 'nw')} />
                    <div className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-white border-2 border-indigo-600 rounded-full cursor-ne-resize shadow-sm" onMouseDown={(e) => handleOutlineResizeHandleMouseDown(e as ReactMouseEvent, outline.id, 'ne')} />
                    <div className="absolute -bottom-1.5 -left-1.5 w-3 h-3 bg-white border-2 border-indigo-600 rounded-full cursor-sw-resize shadow-sm" onMouseDown={(e) => handleOutlineResizeHandleMouseDown(e as ReactMouseEvent, outline.id, 'sw')} />
                    <div className="absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-white border-2 border-indigo-600 rounded-full cursor-se-resize shadow-sm" onMouseDown={(e) => handleOutlineResizeHandleMouseDown(e as ReactMouseEvent, outline.id, 'se')} />
                  </>)}
                </div>
              );
            })}
            {images.map((image: ImageData) => {
              const isSelected = selectedImageIds.includes(image.id);
              return (
                <div key={image.id} className={`absolute cursor-move border-2 rounded-lg overflow-hidden transition-shadow ${isSelected ? 'border-indigo-500 shadow-2xl ring-4 ring-indigo-500/20' : 'border-transparent shadow-md hover:shadow-lg'}`} style={{ left: image.x, top: image.y, width: image.width, height: image.height, zIndex: image.zIndex ?? 6 }} onMouseDown={(e) => handleMouseDownOnImage(e as ReactMouseEvent, image.id)} onContextMenu={(e) => handleImageContextMenu(e as ReactMouseEvent, image.id)} onClick={(e) => handleImageClick(e as ReactMouseEvent, image.id)}>
                  <img src={getImageUrl(image.storagePath)} alt="" className="w-full h-full object-contain pointer-events-none" />
                  {isSelected && selectedImageIds.length === 1 && totalSelectedCount === 1 && (<>
                    <div className="absolute -top-1.5 -left-1.5 w-4 h-4 bg-white border-2 border-indigo-600 rounded-full cursor-nw-resize shadow-md" onMouseDown={(e) => handleResizeHandleMouseDown(e as ReactMouseEvent, image.id, 'nw')} />
                    <div className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-white border-2 border-indigo-600 rounded-full cursor-ne-resize shadow-md" onMouseDown={(e) => handleResizeHandleMouseDown(e as ReactMouseEvent, image.id, 'ne')} />
                    <div className="absolute -bottom-1.5 -left-1.5 w-4 h-4 bg-white border-2 border-indigo-600 rounded-full cursor-sw-resize shadow-md" onMouseDown={(e) => handleResizeHandleMouseDown(e as ReactMouseEvent, image.id, 'sw')} />
                    <div className="absolute -bottom-1.5 -right-1.5 w-4 h-4 bg-white border-2 border-indigo-600 rounded-full cursor-se-resize shadow-md" onMouseDown={(e) => handleResizeHandleMouseDown(e as ReactMouseEvent, image.id, 'se')} />
                  </>)}
                </div>
              );
            })}
            {stickies.map((sticky: StickyData) => {
              const isEditing = editingStickyId === sticky.id;
              const isSelected = selectedStickyIds.includes(sticky.id);
              return (
                <div key={sticky.id} className={`absolute cursor-move rounded-sm overflow-visible transition-shadow group ${isSelected ? 'ring-4 ring-indigo-500/20 shadow-2xl' : 'shadow-lg hover:shadow-xl'}`} style={{ left: sticky.x, top: sticky.y, width: sticky.width, height: sticky.height, zIndex: sticky.zIndex ?? 5 }} onMouseDown={(e) => handleMouseDownOnSticky(e as ReactMouseEvent, sticky.id)} onContextMenu={(e) => handleStickyContextMenu(e as ReactMouseEvent, sticky.id)} onDoubleClick={(e) => { e.stopPropagation(); setEditingStickyId(sticky.id); }} onClick={(e) => handleStickyClick(e as ReactMouseEvent, sticky.id)}>
                  <div className="absolute -bottom-1.5 right-2 w-[70%] h-[50%] -z-10 opacity-40" style={{ backgroundColor: 'rgba(0,0,0,0.3)', transform: 'rotate(3deg)', filter: 'blur(6px)' }} />
                  <div className="relative w-full h-full rounded-sm flex flex-col p-3" style={{ backgroundColor: sticky.bgColor, color: sticky.textColor, boxShadow: '1px 2px 4px rgba(0,0,0,0.05)' }}>
                    <div className="absolute top-0 left-0 w-0 h-0 border-r-[16px] border-r-transparent border-b-[16px] rounded-br-sm" style={{ borderBottomColor: 'rgba(0,0,0,0.08)' }} />
                    <div className="flex-1 flex items-start overflow-hidden">
                      {isEditing ? (
                        <textarea autoFocus className="w-full h-full resize-none bg-transparent border-none outline-none text-sm font-medium pointer-events-auto" defaultValue={sticky.text} onBlur={(e) => { const trimmed = e.currentTarget.value.trim(); updateStickyText(sticky.id, trimmed); setEditingStickyId(null); }} onKeyDown={(e) => { if (e.key === 'Escape') setEditingStickyId(null); }} onMouseDown={(e) => e.stopPropagation()} />
                      ) : (
                        <div className="w-full h-full whitespace-pre-wrap overflow-auto text-sm font-medium cursor-text select-none pointer-events-none">{sticky.text}</div>
                      )}
                    </div>
                    {isSelected && selectedStickyIds.length === 1 && totalSelectedCount === 1 && !isEditing && (
                      <div className="flex justify-end gap-1 mt-1 pointer-events-auto">
                        <button onClick={(e) => { e.stopPropagation(); setShowColorPalette({ stickyId: sticky.id, x: window.innerWidth / 2, y: window.innerHeight / 2 }); }} className="p-1 hover:bg-black/10 rounded"><PaletteIcon /></button>
                        <button onClick={(e) => { e.stopPropagation(); deleteSticky(sticky.id); }} className="p-1 hover:bg-black/10 rounded text-rose-500"><TrashIcon /></button>
                      </div>
                    )}
                  </div>
                  {isSelected && selectedStickyIds.length === 1 && totalSelectedCount === 1 && (<>
                    <div className="absolute -top-1.5 -left-1.5 w-4 h-4 bg-white border-2 border-indigo-600 rounded-full cursor-nw-resize shadow-md" onMouseDown={(e) => handleStickyResizeHandleMouseDown(e as ReactMouseEvent, sticky.id, 'nw')} />
                    <div className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-white border-2 border-indigo-600 rounded-full cursor-ne-resize shadow-md" onMouseDown={(e) => handleStickyResizeHandleMouseDown(e as ReactMouseEvent, sticky.id, 'ne')} />
                    <div className="absolute -bottom-1.5 -left-1.5 w-4 h-4 bg-white border-2 border-indigo-600 rounded-full cursor-sw-resize shadow-md" onMouseDown={(e) => handleStickyResizeHandleMouseDown(e as ReactMouseEvent, sticky.id, 'sw')} />
                    <div className="absolute -bottom-1.5 -right-1.5 w-4 h-4 bg-white border-2 border-indigo-600 rounded-full cursor-se-resize shadow-md" onMouseDown={(e) => handleStickyResizeHandleMouseDown(e as ReactMouseEvent, sticky.id, 'se')} />
                  </>)}
                </div>
              );
            })}
            {stamps.map((stamp) => (
              <div key={stamp.id} className={`absolute cursor-move flex items-center justify-center transition-all duration-300 ${selectedStampIds.includes(stamp.id) ? 'ring-4 ring-indigo-500/30 scale-105 shadow-2xl' : 'hover:shadow-xl hover:scale-105 hover:-translate-y-1'}`} style={{ left: stamp.x, top: stamp.y, width: stamp.width, height: stamp.height, backgroundColor: 'transparent', color: stamp.color, zIndex: stamp.zIndex ?? 3, fontFamily: "'MS Mincho', 'Yu Mincho', serif" }} onMouseDown={(e) => handleMouseDownOnStamp(e, stamp.id)} onContextMenu={(e) => handleStampContextMenu(e, stamp.id)} onClick={(e) => handleStampClick(e, stamp.id)} title={`${stamp.email} の印鑑`}>
                <div className="flex flex-col items-center justify-center w-full h-full rounded-full border-[2.5px] bg-white/90 backdrop-blur-sm relative overflow-hidden" style={{ borderColor: stamp.color, boxShadow: '0 4px 10px rgba(0,0,0,0.1)' }}>
                  <div className="w-full text-center border-b-[1.5px] pb-1 pt-2" style={{ borderColor: stamp.color }}>
                    <span className="text-[8px] font-bold tracking-tighter leading-none block font-sans">{new Date().toLocaleDateString('ja-JP', { year: '2-digit', month: '2-digit', day: '2-digit' }).replace(/\//g, '.')}</span>
                  </div>
                  <div className="w-full text-center pt-1 flex-1 flex items-center justify-center">
                    <span className="text-[13px] font-extrabold tracking-widest leading-none block pb-1">{stamp.text}</span>
                  </div>
                  <div className="absolute inset-0 pointer-events-none rounded-full opacity-30 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0IiBoZWlnaHQ9IjQiPgo8cmVjdCB3aWR0aD0iNCIgaGVpZ2h0PSI0IiBmaWxsPSIjZmZmIiBmaWxsLW9wYWNpdHk9IjAuMSIvPgo8cGF0aCBkPSJNMCAwdjRoNFYweiIgZmlsbD0ibm9uZSIvPgo8L3N2Zz4=')]"></div>
                </div>
              </div>
            ))}
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
                const startPt = getConnectionPoint(parentPos.x, parentPos.y, parentPoint, parentPos.width, parentPos.height); 
                const endPt = getConnectionPoint(childPos.x, childPos.y, childPoint, childPos.width, childPos.height); 
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
                    <path d={el.pathD} fill="none" stroke={el.selected ? '#6366f1' : '#94a3b8'} strokeWidth={el.selected ? 4 : 3} markerStart={markerStart} markerEnd={markerEnd} className={`${el.selected ? 'drop-shadow-md' : 'pointer-events-none'} ${isAnyDragging ? '' : 'transition-all duration-300 ease-out'} ${el.selected ? 'stroke-indigo-500' : 'stroke-slate-400 hover:stroke-slate-500'}`} onClick={el.selected ? undefined : (e) => handleEdgeClick(e as ReactMouseEvent, el.id)} onContextMenu={(e) => handleEdgeContextMenu(e as ReactMouseEvent, el.id)} />
                    {el.selected && (<>
                      <circle cx={el.sourceX} cy={el.sourceY} r={8} fill="#ffffff" stroke="#6366f1" strokeWidth={3} className="cursor-grab pointer-events-auto hover:scale-125 transition-transform shadow-md" onMouseDown={(e) => handleEdgeEndpointMouseDown(e as ReactMouseEvent, el.id, 'source')} />
                      <circle cx={el.targetX} cy={el.targetY} r={8} fill="#ffffff" stroke="#6366f1" strokeWidth={3} className="cursor-grab pointer-events-auto hover:scale-125 transition-transform shadow-md" onMouseDown={(e) => handleEdgeEndpointMouseDown(e as ReactMouseEvent, el.id, 'target')} />
                    </>)}
                  </g>
                ); 
              })}
              {drawingEdge && mindMap && (
                <path d={(() => {
                    const sNode = findNodeById(mindMap, drawingEdge.sourceNodeId);
                    if (!sNode) return '';
                    const sw = sNode.width ?? (sNode.imageUrl && sNode.imageWidth && sNode.imageScale ? sNode.imageWidth * sNode.imageScale : NODE_WIDTH);
                    const sh = sNode.height ?? (sNode.imageUrl && sNode.imageHeight && sNode.imageScale ? sNode.imageHeight * sNode.imageScale : NODE_HEIGHT);
                    return getEdgePath(getConnectionPoint(sNode.x, sNode.y, drawingEdge.sourcePoint, sw, sh), {x: drawingEdge.currentX, y: drawingEdge.currentY}, drawingEdge.sourcePoint, drawingEdge.targetPoint || 'left', edgeStyle);
                  })()} fill="none" stroke="#818cf8" strokeWidth={4} strokeDasharray="8,8" className="pointer-events-none drop-shadow-sm" />
              )}
              {selectionRect && (
                <rect x={Math.min(selectionRect.x1, selectionRect.x2)} y={Math.min(selectionRect.y1, selectionRect.y2)} width={Math.abs(selectionRect.x2 - selectionRect.x1)} height={Math.abs(selectionRect.y2 - selectionRect.y1)} fill="rgba(99, 102, 241, 0.15)" stroke="#6366f1" strokeWidth={2} strokeDasharray="6 6" className="rounded-sm" />
              )}
            </svg>
            <RecursiveNode 
              node={mindMap} 
              selectedNodeId={selectedNodeId} 
              selectedNodeIds={selectedNodeIds} 
              editingNodeId={editingNodeId} 
              draggingNodeId={draggingNodeId} 
              dragPositions={dragPositions} 
              dragTargetNodeId={dragTargetNodeId} 
              isMultiDragging={isMultiDragging} 
              awarenessStates={awarenessStates} 
              myUserId={myUserId} 
              onNodeClick={handleNodeClick} 
              onNodeDoubleClick={handleNodeDoubleClick} 
              onMouseDownOnNode={handleMouseDownOnNode} 
              onTextEditComplete={handleTextEditComplete} 
              onContextMenu={handleNodeContextMenu} 
              onConnectionPointMouseDown={handleConnectionPointMouseDown} 
              depth={0} 
              isAnyDragging={isAnyDragging} 
              updateNodeWidth={updateNodeWidth}
              updateNodeFontSize={updateNodeFontSize}
              toggleCollapse={toggleNodeCollapse}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

// ==================== 再帰ノード ====================
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
  updateNodeWidth: (nodeId: string, width: number) => void;
  updateNodeFontSize: (nodeId: string, fontSize: number) => void;
  toggleCollapse: (nodeId: string) => void;
}

const RecursiveNode = ({ node, selectedNodeId, selectedNodeIds, editingNodeId, draggingNodeId, dragPositions, dragTargetNodeId, isMultiDragging, awarenessStates, myUserId, onNodeClick, onNodeDoubleClick, onMouseDownOnNode, onTextEditComplete, onContextMenu, onConnectionPointMouseDown, depth, isAnyDragging, updateNodeWidth, updateNodeFontSize, toggleCollapse }: RecursiveNodeProps) => {
  const isSelected = selectedNodeIds.includes(node.id);
  const isSingleSelected = selectedNodeId === node.id;
  const isEditing = editingNodeId === node.id;
  const isSingleDragging = draggingNodeId === node.id;
  const isTarget = dragTargetNodeId === node.id;
  const inputRef = useRef<HTMLInputElement>(null);

  let nodeWidth = node.width ?? (node.imageUrl ? IMAGE_NODE_MAX_INITIAL_SIZE : NODE_WIDTH);
  let nodeHeight = node.height ?? (node.imageUrl ? IMAGE_NODE_MAX_INITIAL_SIZE : NODE_HEIGHT);
  if (node.imageUrl && node.imageWidth && node.imageHeight) {
    const scale = node.imageScale ?? 1.0;
    nodeWidth = node.imageWidth * scale;
    nodeHeight = node.imageHeight * scale;
  }
  const fontSize = node.fontSize ?? NODE_DEFAULT_FONT_SIZE;

  useEffect(() => {
    if (!node.imageUrl) {
      const newWidth = computeNodeWidth(node.text, fontSize);
      if (Math.abs(newWidth - nodeWidth) > 1) {
        updateNodeWidth(node.id, newWidth);
      }
    }
  }, [node.text, fontSize, node.id, updateNodeWidth, nodeWidth, node.imageUrl]);

  const displayPos = (() => {
    if (isMultiDragging && dragPositions[node.id]) return dragPositions[node.id];
    if (isSingleDragging && dragPositions[node.id]) return dragPositions[node.id];
    return { x: node.x, y: node.y };
  })();

  useEffect(() => { if (isEditing && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); } }, [isEditing]);
  const handleBlur = () => { if (inputRef.current) onTextEditComplete(node.id, inputRef.current.value); };
  const handleInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      if (e.nativeEvent.isComposing) return;
      e.preventDefault();
      if (inputRef.current) onTextEditComplete(node.id, inputRef.current.value);
    } else if (e.key === 'Escape') {
      onTextEditComplete(node.id, node.text);
    }
  };
  const remoteEditors = Object.entries(awarenessStates).filter(([, state]: [string, AwarenessState]) => state.editingNodeId === node.id).map(([, state]: [string, AwarenessState]) => state);
  const remoteSelectors = Object.entries(awarenessStates).filter(([, state]: [string, AwarenessState]) => state.selectedNodeId === node.id && state.editingNodeId !== node.id).map(([, state]: [string, AwarenessState]) => state);
  
  const borderColorClass = isTarget ? 'border-emerald-500 border-2 ring-4 ring-emerald-500/20' : (isSelected ? (isSingleSelected ? 'border-indigo-600 ring-4 ring-indigo-600/20' : 'border-purple-600 ring-4 ring-purple-600/20') : 'border-transparent');
  const connectionPoints: ConnectionPoint[] = ['top', 'right', 'bottom', 'left'];

  return (
    <>
      <div
        className={`absolute flex items-center justify-center rounded-2xl border-2 px-5 py-3 cursor-pointer select-none ${isAnyDragging ? '' : 'transition-all duration-300 ease-out'} ${isSelected ? 'shadow-2xl shadow-indigo-500/30' : ''} ${borderColorClass} ${isEditing ? 'bg-amber-50 ring-4 ring-amber-400/30 border-amber-400' : ''} ${!isSelected && !isTarget && !isEditing ? 'hover:-translate-y-0.5 hover:border-slate-300' : ''}`}
        style={{
          left: displayPos.x - nodeWidth/2, top: displayPos.y - nodeHeight/2,
          width: nodeWidth, height: nodeHeight, zIndex: node.zIndex ?? (10 + depth),
          backgroundColor: node.bgColor || '#ffffff',
          borderColor: isSelected || isEditing || isTarget ? undefined : (node.textColor || '#0ea5e9'),
          color: node.textColor || '#0f172a',
        }}
        onClick={e => onNodeClick(e, node.id)} onDoubleClick={e => onNodeDoubleClick(e, node.id)} onMouseDown={e => onMouseDownOnNode(e, node.id)} onContextMenu={e => onContextMenu(e, node.id)}
      >
        {node.children.length > 0 && (
          <div 
            className="absolute -top-3 -left-3 w-6 h-6 bg-white border border-slate-300 rounded-full flex items-center justify-center cursor-pointer hover:bg-slate-100 shadow-md z-10 pointer-events-auto"
            onClick={(e) => { e.stopPropagation(); toggleCollapse(node.id); }}
          >
            {node.collapsed ? <ExpandIcon /> : <CollapseIcon />}
          </div>
        )}
        {node.imageUrl ? (
          <div className="w-full h-full flex flex-col items-center justify-center p-1">
            <img src={node.imageUrl} alt="node image" className="max-w-full max-h-full object-contain rounded" />
            {node.text && <span className="text-xs mt-1 truncate absolute bottom-0 left-0 right-0 text-center bg-black/50 text-white rounded-b-md">{node.text}</span>}
          </div>
        ) : (
          <>
            {isEditing ? (
              <input ref={inputRef} className={`w-full h-full bg-transparent text-center outline-none border-none focus:ring-0`} style={{ fontSize }} defaultValue={node.text} onBlur={handleBlur} onKeyDown={handleInputKeyDown} onClick={e => e.stopPropagation()} />
            ) : (
              <span className="whitespace-nowrap" style={{ color: node.textColor || '#1e293b', fontSize }}>{node.text}</span>
            )}
          </>
        )}
        {remoteEditors.length > 0 && <div className="absolute -top-2.5 -right-2.5 flex -space-x-1.5">{remoteEditors.map((editor: AwarenessState, i: number) => <div key={i} className="w-5 h-5 rounded-full border-2 border-white shadow-md animate-pulse" style={{ backgroundColor: editor.color }} title={`${editor.email} が編集中`} />)}</div>}
        {remoteSelectors.length > 0 && remoteEditors.length === 0 && <div className="absolute -top-2.5 -right-2.5 flex -space-x-1.5">{remoteSelectors.map((selector: AwarenessState, i: number) => <div key={i} className="w-4 h-4 rounded-full border-2 border-white opacity-80 shadow-sm" style={{ backgroundColor: selector.color }} title={`${selector.email} が選択中`} />)}</div>}
        
        {isSingleSelected && !isEditing && !isMultiDragging && !node.imageUrl && (
          <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 bg-white border border-slate-200 rounded-lg shadow-lg flex items-center p-1 z-30">
            <select 
              value={fontSize}
              onChange={(e) => updateNodeFontSize(node.id, Number(e.target.value))}
              className="text-xs bg-slate-50 border border-slate-300 rounded px-2 py-0.5 outline-none"
            >
              {FONT_SIZES.map(size => <option key={size} value={size}>{size}px</option>)}
            </select>
          </div>
        )}
      </div>
      {isSingleSelected && !isMultiDragging && connectionPoints.map((point: ConnectionPoint) => { const pt = getConnectionPoint(displayPos.x, displayPos.y, point, nodeWidth, nodeHeight); return <div key={point} className={`absolute w-4 h-4 bg-white border-2 border-indigo-600 rounded-full cursor-crosshair hover:scale-150 hover:bg-indigo-50 shadow-md ${isAnyDragging ? '' : 'transition-all duration-300 ease-out'}`} style={{ left: pt.x-8, top: pt.y-8, zIndex: 20 + depth }} onMouseDown={e => onConnectionPointMouseDown(e, node.id, point)} />; })}
      {!node.collapsed && node.children.map((child: MindNode) => (<RecursiveNode key={child.id} node={child} selectedNodeId={selectedNodeId} selectedNodeIds={selectedNodeIds} editingNodeId={editingNodeId} draggingNodeId={draggingNodeId} dragPositions={dragPositions} dragTargetNodeId={dragTargetNodeId} isMultiDragging={isMultiDragging} awarenessStates={awarenessStates} myUserId={myUserId} onNodeClick={onNodeClick} onNodeDoubleClick={onNodeDoubleClick} onMouseDownOnNode={onMouseDownOnNode} onTextEditComplete={onTextEditComplete} onContextMenu={onContextMenu} onConnectionPointMouseDown={onConnectionPointMouseDown} depth={depth+1} isAnyDragging={isAnyDragging} updateNodeWidth={updateNodeWidth} updateNodeFontSize={updateNodeFontSize} toggleCollapse={toggleCollapse} />))}
    </>
  );
};

export default App;