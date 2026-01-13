const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const draggableBox = document.getElementById('draggableBox');
const draggableCircle = document.getElementById('draggableCircle');
const draggableText = document.getElementById('draggableText');
const canvasContainer = document.querySelector('.canvas-container');
const textEditor = document.getElementById('textEditor');
const colorPicker = document.getElementById('colorPicker');
const selectTool = document.getElementById('selectTool');
const lassoTool = document.getElementById('lassoTool');
const arrowDirectionPanel = document.getElementById('arrowDirectionPanel');

// Set canvas size
function resizeCanvas() {
    const rect = canvasContainer.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = 600;
}

resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// Tool state
let currentTool = 'select'; // 'select', 'lasso'
let selectedShapes = new Set(); // Can contain Box, Circle, or TextObject
let selectedConnections = new Set(); // Can contain Connection objects
let isDragging = false;
let dragOffset = { x: 0, y: 0 };
let dragStartPos = { x: 0, y: 0 }; // Store initial drag position
let dragStartShapes = []; // Store initial positions of shapes when drag starts
let dragStartLassoPoints = null; // Store initial lasso points when drag starts
let isResizing = false; // True when resizing an object
let resizeHandle = null; // Which handle is being dragged: 'nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'
let resizeStartPos = { x: 0, y: 0 }; // Initial mouse position when resize starts
let resizeStartShape = null; // The shape being resized
let resizeStartBounds = { x: 0, y: 0, width: 0, height: 0 }; // Initial bounds when resize starts
let resizeStartBoxStates = []; // Store original states of all boxes in a group when resizing
let isPanning = false;
let panStart = { x: 0, y: 0 };
let panOffset = { x: 0, y: 0 };
let canvasOffset = { x: 0, y: 0 };
let editingText = null;
// Initialize currentColor from the color picker's value
let currentColor = colorPicker.value;

// Shift-click placement state
let selectedShapeTypeForPlacement = null; // 'box', 'circle', 'text', or null

// Lasso selection
let isLassoActive = false;
let lassoPoints = [];
let completedLassoPoints = null; // Store completed lasso shape
let lassoBlinkAnimation = 0; // For blinking effect

// Connection state
let connections = [];
let pendingEdgeSelection = null; // { shape, edge } for first edge selection
let tempConnectionEnd = null; // { x, y } for preview
let waitingForArrowSelection = false; // True when both edges selected, waiting for arrow choice
let selectedConnection = null; // Connection being edited

// Box split preview state
let splitPreviewBox = null; // Box being hovered over for split preview
let splitPreviewDirection = null; // 'horizontal' or 'vertical'
let splitPreviewSide = null; // 'top', 'bottom', 'left', or 'right' - which side gets the new box
let draggedShapeType = null; // Track what shape is being dragged

// Box groups for split boxes that move together
let boxGroups = new Map(); // Map<Box, Set<Box>> - groups of boxes that move together

// Store objects on canvas
let boxes = [];
let circles = [];
let textObjects = [];

// Base class for all drawable objects
class DrawableObject {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.color = currentColor;
    }
    
    contains(x, y) {
        return false; // Override in subclasses
    }
    
    draw(isSelected = false) {
        // Override in subclasses
    }
    
    getBounds() {
        return { x: this.x, y: this.y, width: 0, height: 0 }; // Override in subclasses
    }
}

// Box class
class Box extends DrawableObject {
    constructor(x, y) {
        super(x, y);
        this.width = 80;
        this.height = 80;
        this.color = currentColor;
        this.text = '';
        this.groupId = null; // ID for boxes that move together (from splits)
    }
    
    // Get all boxes in the same group (for split boxes)
    getGroup() {
        if (!this.groupId) return new Set([this]);
        const group = new Set();
        boxes.forEach(box => {
            if (box.groupId === this.groupId) {
                group.add(box);
            }
        });
        return group;
    }
    
    // Get the bounding box of the entire group
    getGroupBounds() {
        const group = this.getGroup();
        if (group.size === 1) {
            return this.getBounds();
        }
        
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;
        
        group.forEach(box => {
            minX = Math.min(minX, box.x);
            minY = Math.min(minY, box.y);
            maxX = Math.max(maxX, box.x + box.width);
            maxY = Math.max(maxY, box.y + box.height);
        });
        
        return {
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY
        };
    }
    
    // Check if this box is part of a group that should be resized together
    isGroupResize() {
        return this.groupId && this.getGroup().size > 1;
    }

    draw(isSelected = false) {
        ctx.fillStyle = this.color;
        ctx.fillRect(this.x + canvasOffset.x, this.y + canvasOffset.y, this.width, this.height);
        
        ctx.strokeStyle = isSelected ? '#48bb78' : '#333';
        ctx.lineWidth = isSelected ? 3 : 2;
        ctx.strokeRect(this.x + canvasOffset.x, this.y + canvasOffset.y, this.width, this.height);
        
        // Draw text if it exists
        if (this.text) {
        // Dynamically determine text color based on background color contrast
        ctx.fillStyle = getContrastColor(this.color);
        ctx.font = 'bold 24px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        // Handle text overflow - truncate if too long
        const maxWidth = this.width - 10;
        let displayText = this.text;
        const metrics = ctx.measureText(displayText);
        if (metrics.width > maxWidth) {
            // Truncate text with ellipsis
            while (ctx.measureText(displayText + '...').width > maxWidth && displayText.length > 0) {
                displayText = displayText.slice(0, -1);
            }
            displayText = displayText + '...';
        }
        
            ctx.fillText(displayText, this.x + canvasOffset.x + this.width / 2, this.y + canvasOffset.y + this.height / 2);
        }
    }

    contains(x, y) {
        const worldX = x - canvasOffset.x;
        const worldY = y - canvasOffset.y;
        return worldX >= this.x && worldX <= this.x + this.width &&
               worldY >= this.y && worldY <= this.y + this.height;
    }
    
    getBounds() {
        return { x: this.x, y: this.y, width: this.width, height: this.height };
    }
    
    // Get resize handle positions (8 handles: corners and midpoints)
    getResizeHandles() {
        const screenX = this.x + canvasOffset.x;
        const screenY = this.y + canvasOffset.y;
        const w = this.width;
        const h = this.height;
        return {
            'nw': { x: screenX, y: screenY },
            'n': { x: screenX + w / 2, y: screenY },
            'ne': { x: screenX + w, y: screenY },
            'e': { x: screenX + w, y: screenY + h / 2 },
            'se': { x: screenX + w, y: screenY + h },
            's': { x: screenX + w / 2, y: screenY + h },
            'sw': { x: screenX, y: screenY + h },
            'w': { x: screenX, y: screenY + h / 2 }
        };
    }
    
    // Check if a point is on a resize handle
    getResizeHandleAt(x, y, handleSize = 8) {
        // Use padded handles if available (from drawResizeHandles), otherwise use object bounds
        const handles = this._paddedResizeHandles || this.getResizeHandles();
        for (const [handleName, handlePos] of Object.entries(handles)) {
            const dx = x - handlePos.x;
            const dy = y - handlePos.y;
            if (Math.abs(dx) <= handleSize && Math.abs(dy) <= handleSize) {
                return handleName;
            }
        }
        return null;
    }

    // Get the edge point based on edge name ('top', 'bottom', 'left', 'right')
    getEdgePoint(edge) {
        switch(edge) {
            case 'top':
                return { x: this.x + this.width / 2, y: this.y };
            case 'bottom':
                return { x: this.x + this.width / 2, y: this.y + this.height };
            case 'left':
                return { x: this.x, y: this.y + this.height / 2 };
            case 'right':
                return { x: this.x + this.width, y: this.y + this.height / 2 };
            default:
                return { x: this.x + this.width / 2, y: this.y + this.height / 2 };
        }
    }

    // Check if an edge is already connected
    isEdgeConnected(edge) {
        // Check if this edge is already used in any connection
        for (const conn of connections) {
            if ((conn.fromShape === this && conn.fromEdge === edge) ||
                (conn.toShape === this && conn.toEdge === edge)) {
                return true;
            }
        }
        return false;
    }
    
    // Detect which edge was clicked (with some tolerance)
    getEdgeAt(x, y, tolerance = 10) {
        const worldX = x - canvasOffset.x;
        const worldY = y - canvasOffset.y;
        const centerX = this.x + this.width / 2;
        const centerY = this.y + this.height / 2;
        const dx = worldX - centerX;
        const dy = worldY - centerY;
        
        // Check if click is near an edge
        let detectedEdge = null;
        if (Math.abs(worldX - this.x) < tolerance && Math.abs(dy) < this.height / 2) {
            detectedEdge = 'left';
        } else if (Math.abs(worldX - (this.x + this.width)) < tolerance && Math.abs(dy) < this.height / 2) {
            detectedEdge = 'right';
        } else if (Math.abs(worldY - this.y) < tolerance && Math.abs(dx) < this.width / 2) {
            detectedEdge = 'top';
        } else if (Math.abs(worldY - (this.y + this.height)) < tolerance && Math.abs(dx) < this.width / 2) {
            detectedEdge = 'bottom';
        }
        
        // Don't allow connections on split edges
        if (detectedEdge && this.splitEdge === detectedEdge) {
            return null;
        }
        
        // Don't allow connections on already connected edges
        if (detectedEdge && this.isEdgeConnected(detectedEdge)) {
            return null;
        }
        
        return detectedEdge;
    }
    
    // Get best edge for connection creation - uses larger zones that don't overlap
    // Always returns an edge if point is within or near the shape
    getBestEdgeForConnection(x, y) {
        const worldX = x - canvasOffset.x;
        const worldY = y - canvasOffset.y;
        const centerX = this.x + this.width / 2;
        const centerY = this.y + this.height / 2;
        const dx = worldX - centerX;
        const dy = worldY - centerY;
        
        // Check if point is within the shape bounds (with some padding)
        const padding = 20;
        const isWithinBounds = worldX >= this.x - padding && worldX <= this.x + this.width + padding &&
                              worldY >= this.y - padding && worldY <= this.y + this.height + padding;
        
        if (!isWithinBounds) {
            return null;
        }
        
        // Divide into 4 quadrants - each quadrant maps to one edge
        // This ensures non-overlapping zones
        let proposedEdge;
        if (dx <= 0 && dy <= 0) {
            // Top-left quadrant -> top edge
            proposedEdge = 'top';
        } else if (dx > 0 && dy <= 0) {
            // Top-right quadrant -> right edge
            proposedEdge = 'right';
        } else if (dx <= 0 && dy > 0) {
            // Bottom-left quadrant -> left edge
            proposedEdge = 'left';
        } else {
            // Bottom-right quadrant -> bottom edge
            proposedEdge = 'bottom';
        }
        
        // Don't allow connections on split edges
        if (this.splitEdge === proposedEdge) {
            return null;
        }
        
        // Don't allow connections on already connected edges
        if (this.isEdgeConnected(proposedEdge)) {
            return null;
        }
        
        return proposedEdge;
    }
}

// Circle class (supports ellipses via radiusX and radiusY)
class Circle extends DrawableObject {
    constructor(x, y) {
        super(x, y);
        this.radius = 40; // Default radius for backward compatibility
        this.radiusX = 40; // Horizontal radius (for ellipses)
        this.radiusY = 40; // Vertical radius (for ellipses)
        this.color = currentColor;
        this.text = '';
    }

    draw(isSelected = false) {
        ctx.fillStyle = this.color;
        ctx.beginPath();
        // Use ellipse if radiusX != radiusY, otherwise use circle
        if (this.radiusX !== this.radiusY) {
            ctx.ellipse(
                this.x + canvasOffset.x + this.radiusX,
                this.y + canvasOffset.y + this.radiusY,
                this.radiusX,
                this.radiusY,
                0, 0, Math.PI * 2
            );
        } else {
            ctx.arc(
                this.x + canvasOffset.x + this.radiusX,
                this.y + canvasOffset.y + this.radiusY,
                this.radiusX,
                0, Math.PI * 2
            );
        }
        ctx.fill();
        
        ctx.strokeStyle = isSelected ? '#48bb78' : '#333';
        ctx.lineWidth = isSelected ? 3 : 2;
        ctx.stroke();
        
        // Draw text if it exists
        if (this.text) {
        // Dynamically determine text color based on background color contrast
        ctx.fillStyle = getContrastColor(this.color);
        ctx.font = 'bold 24px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        // Handle text overflow - truncate if too long
        const maxWidth = Math.min(this.radiusX, this.radiusY) * 1.8;
        let displayText = this.text;
        const metrics = ctx.measureText(displayText);
        if (metrics.width > maxWidth) {
            // Truncate text with ellipsis
            while (ctx.measureText(displayText + '...').width > maxWidth && displayText.length > 0) {
                displayText = displayText.slice(0, -1);
            }
            displayText = displayText + '...';
        }
        
            ctx.fillText(displayText, this.x + canvasOffset.x + this.radiusX, this.y + canvasOffset.y + this.radiusY);
        }
    }

    contains(x, y) {
        const worldX = x - canvasOffset.x;
        const worldY = y - canvasOffset.y;
        const centerX = this.x + this.radiusX;
        const centerY = this.y + this.radiusY;
        const dx = (worldX - centerX) / this.radiusX;
        const dy = (worldY - centerY) / this.radiusY;
        return (dx * dx + dy * dy) <= 1; // Ellipse equation
    }
    
    getBounds() {
        return {
            x: this.x,
            y: this.y,
            width: this.radiusX * 2,
            height: this.radiusY * 2
        };
    }
    
    // Get resize handle positions (8 handles: corners and midpoints)
    getResizeHandles() {
        const screenX = this.x + canvasOffset.x;
        const screenY = this.y + canvasOffset.y;
        const w = this.radiusX * 2;
        const h = this.radiusY * 2;
        return {
            'nw': { x: screenX, y: screenY },
            'n': { x: screenX + w / 2, y: screenY },
            'ne': { x: screenX + w, y: screenY },
            'e': { x: screenX + w, y: screenY + h / 2 },
            'se': { x: screenX + w, y: screenY + h },
            's': { x: screenX + w / 2, y: screenY + h },
            'sw': { x: screenX, y: screenY + h },
            'w': { x: screenX, y: screenY + h / 2 }
        };
    }
    
    // Check if a point is on a resize handle
    getResizeHandleAt(x, y, handleSize = 8) {
        // Use padded handles if available (from drawResizeHandles), otherwise use object bounds
        const handles = this._paddedResizeHandles || this.getResizeHandles();
        for (const [handleName, handlePos] of Object.entries(handles)) {
            const dx = x - handlePos.x;
            const dy = y - handlePos.y;
            if (Math.abs(dx) <= handleSize && Math.abs(dy) <= handleSize) {
                return handleName;
            }
        }
        return null;
    }

    // Get the edge point based on edge name ('top', 'bottom', 'left', 'right')
    getEdgePoint(edge) {
        const centerX = this.x + this.radiusX;
        const centerY = this.y + this.radiusY;
        switch(edge) {
            case 'top':
                return { x: centerX, y: this.y };
            case 'bottom':
                return { x: centerX, y: this.y + this.radiusY * 2 };
            case 'left':
                return { x: this.x, y: centerY };
            case 'right':
                return { x: this.x + this.radiusX * 2, y: centerY };
            default:
                return { x: centerX, y: centerY };
        }
    }

    // Detect which edge was clicked (with some tolerance)
    getEdgeAt(x, y, tolerance = 10) {
        const worldX = x - canvasOffset.x;
        const worldY = y - canvasOffset.y;
        const centerX = this.x + this.radiusX;
        const centerY = this.y + this.radiusY;
        const dx = worldX - centerX;
        const dy = worldY - centerY;
        // For ellipse, check distance along the ellipse edge
        const normalizedDx = dx / this.radiusX;
        const normalizedDy = dy / this.radiusY;
        const distance = Math.sqrt(normalizedDx * normalizedDx + normalizedDy * normalizedDy);
        
        // Check if click is near the edge of the ellipse
        if (Math.abs(distance - 1) * Math.min(this.radiusX, this.radiusY) < tolerance) {
            // Determine which edge based on angle
            const angle = Math.atan2(dy, dx);
            const angleDeg = (angle * 180 / Math.PI + 360) % 360;
            
            if (angleDeg >= 45 && angleDeg < 135) {
                return 'bottom';
            } else if (angleDeg >= 135 && angleDeg < 225) {
                return 'left';
            } else if (angleDeg >= 225 && angleDeg < 315) {
                return 'top';
            } else {
                return 'right';
            }
        }
        
        return null;
    }
    
    // Get best edge for connection creation - uses larger zones that don't overlap
    // Always returns an edge if point is within or near the shape
    getBestEdgeForConnection(x, y) {
        const worldX = x - canvasOffset.x;
        const worldY = y - canvasOffset.y;
        const centerX = this.x + this.radiusX;
        const centerY = this.y + this.radiusY;
        const dx = worldX - centerX;
        const dy = worldY - centerY;
        const normalizedDx = dx / this.radiusX;
        const normalizedDy = dy / this.radiusY;
        const distance = Math.sqrt(normalizedDx * normalizedDx + normalizedDy * normalizedDy);
        
        // Check if point is within the ellipse bounds (with some padding)
        const padding = 20 / Math.min(this.radiusX, this.radiusY);
        if (distance > 1 + padding) {
            return null;
        }
        
        // Divide into 4 quadrants based on angle - each quadrant maps to one edge
        // This ensures non-overlapping zones
        const angle = Math.atan2(dy, dx);
        const angleDeg = (angle * 180 / Math.PI + 360) % 360;
        
        if (angleDeg >= 45 && angleDeg < 135) {
            return 'bottom';
        } else if (angleDeg >= 135 && angleDeg < 225) {
            return 'left';
        } else if (angleDeg >= 225 && angleDeg < 315) {
            return 'top';
        } else {
            return 'right';
        }
    }
}

// Text object class
class TextObject extends DrawableObject {
    constructor(x, y) {
        super(x, y);
        this.text = 'Text';
        this.fontSize = 20;
        this.color = currentColor;
        this.textColor = currentColor; // Use current color from color picker
    }

    draw(isSelected = false) {
        ctx.font = `${this.fontSize}px sans-serif`;
        ctx.fillStyle = this.textColor;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        
        const metrics = ctx.measureText(this.text);
        const textX = this.x + canvasOffset.x;
        const textY = this.y + canvasOffset.y;
        
        ctx.fillText(this.text, textX, textY);
        
        if (isSelected) {
            // Draw selection box
            ctx.strokeStyle = '#48bb78';
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 5]);
            ctx.strokeRect(textX - 2, textY - 2, metrics.width + 4, this.fontSize + 4);
            ctx.setLineDash([]);
        }
    }

    contains(x, y) {
        const worldX = x - canvasOffset.x;
        const worldY = y - canvasOffset.y;
        ctx.font = `${this.fontSize}px sans-serif`;
        const metrics = ctx.measureText(this.text);
        return worldX >= this.x - 2 && worldX <= this.x + metrics.width + 2 &&
               worldY >= this.y - 2 && worldY <= this.y + this.fontSize + 2;
    }
    
    getBounds() {
        ctx.font = `${this.fontSize}px sans-serif`;
        const metrics = ctx.measureText(this.text);
        return { x: this.x, y: this.y, width: metrics.width, height: this.fontSize };
    }
    
    // Get resize handle positions (4 handles: corners only, no side or top/bottom handles)
    getResizeHandles() {
        ctx.font = `${this.fontSize}px sans-serif`;
        const metrics = ctx.measureText(this.text);
        const screenX = this.x + canvasOffset.x;
        const screenY = this.y + canvasOffset.y;
        const w = metrics.width;
        const h = this.fontSize;
        return {
            'nw': { x: screenX, y: screenY },
            'ne': { x: screenX + w, y: screenY },
            'se': { x: screenX + w, y: screenY + h },
            'sw': { x: screenX, y: screenY + h }
            // Note: Only corner handles for text objects
        };
    }
    
    // Check if a point is on a resize handle
    getResizeHandleAt(x, y, handleSize = 8) {
        // Use padded handles if available (from drawResizeHandles), otherwise use object bounds
        const handles = this._paddedResizeHandles || this.getResizeHandles();
        for (const [handleName, handlePos] of Object.entries(handles)) {
            const dx = x - handlePos.x;
            const dy = y - handlePos.y;
            if (Math.abs(dx) <= handleSize && Math.abs(dy) <= handleSize) {
                return handleName;
            }
        }
        return null;
    }
}

// Connection class
class Connection {
    constructor(fromShape, fromEdge, toShape, toEdge, direction = 'forward', color = currentColor) {
        this.fromShape = fromShape; // Can be Box or Circle
        this.fromEdge = fromEdge;
        this.toShape = toShape; // Can be Box or Circle
        this.toEdge = toEdge;
        this.direction = direction; // 'forward', 'backward', 'both', 'none'
        this.color = color;
    }

    draw() {
        const fromPoint = this.fromShape.getEdgePoint(this.fromEdge);
        const toPoint = this.toShape.getEdgePoint(this.toEdge);
        
        // Convert to screen coordinates
        const fromScreenX = fromPoint.x + canvasOffset.x;
        const fromScreenY = fromPoint.y + canvasOffset.y;
        const toScreenX = toPoint.x + canvasOffset.x;
        const toScreenY = toPoint.y + canvasOffset.y;
        
        ctx.strokeStyle = this.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(fromScreenX, fromScreenY);
        ctx.lineTo(toScreenX, toScreenY);
        ctx.stroke();
        
        // Draw arrows based on direction
        if (this.direction === 'forward' || this.direction === 'both') {
            this.drawArrow(toScreenX, toScreenY, fromScreenX, fromScreenY);
        }
        if (this.direction === 'backward' || this.direction === 'both') {
            this.drawArrow(fromScreenX, fromScreenY, toScreenX, toScreenY);
        }
    }

    drawArrow(pointX, pointY, fromX, fromY) {
        const angle = Math.atan2(pointY - fromY, pointX - fromX);
        const arrowLength = 10;
        const arrowWidth = 6;
        
        ctx.save();
        ctx.translate(pointX, pointY);
        ctx.rotate(angle);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-arrowLength, -arrowWidth);
        ctx.lineTo(-arrowLength, arrowWidth);
        ctx.closePath();
        ctx.fillStyle = this.color;
        ctx.fill();
        ctx.restore();
    }

    // Check if a point is near this connection line
    isPointNear(x, y, tolerance = 10) {
        const fromPoint = this.fromShape.getEdgePoint(this.fromEdge);
        const toPoint = this.toShape.getEdgePoint(this.toEdge);
        
        // Convert to screen coordinates
        const fromScreenX = fromPoint.x + canvasOffset.x;
        const fromScreenY = fromPoint.y + canvasOffset.y;
        const toScreenX = toPoint.x + canvasOffset.x;
        const toScreenY = toPoint.y + canvasOffset.y;
        
        // Calculate distance from point to line segment
        const A = x - fromScreenX;
        const B = y - fromScreenY;
        const C = toScreenX - fromScreenX;
        const D = toScreenY - fromScreenY;
        
        const dot = A * C + B * D;
        const lenSq = C * C + D * D;
        let param = -1;
        
        if (lenSq !== 0) {
            param = dot / lenSq;
        }
        
        let xx, yy;
        
        if (param < 0) {
            xx = fromScreenX;
            yy = fromScreenY;
        } else if (param > 1) {
            xx = toScreenX;
            yy = toScreenY;
        } else {
            xx = fromScreenX + param * C;
            yy = fromScreenY + param * D;
        }
        
        const dx = x - xx;
        const dy = y - yy;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        // Don't detect clicks too close to the edge points (to avoid overlap with edge selection)
        const distToFrom = Math.sqrt((x - fromScreenX) ** 2 + (y - fromScreenY) ** 2);
        const distToTo = Math.sqrt((x - toScreenX) ** 2 + (y - toScreenY) ** 2);
        const minDistFromEndpoints = 15; // Minimum distance from endpoints to detect connection
        
        if (distToFrom < minDistFromEndpoints || distToTo < minDistFromEndpoints) {
            return false; // Too close to endpoints, let edge selection handle it
        }
        
        return distance <= tolerance;
    }
}

// Draw grid background (1 inch = 96 pixels at 96 DPI)
// Grid is in world space, moves with canvas panning
function drawGrid() {
    const gridSize = 96; // 1 inch in pixels
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 1;
    
    // Calculate visible area in world coordinates
    const worldStartX = -canvasOffset.x;
    const worldStartY = -canvasOffset.y;
    const worldEndX = worldStartX + canvas.width;
    const worldEndY = worldStartY + canvas.height;
    
    // Calculate grid line positions
    const startX = Math.floor(worldStartX / gridSize) * gridSize;
    const startY = Math.floor(worldStartY / gridSize) * gridSize;
    
    // Draw vertical lines
    for (let x = startX; x <= worldEndX; x += gridSize) {
        const screenX = x + canvasOffset.x;
        ctx.beginPath();
        ctx.moveTo(screenX, 0);
        ctx.lineTo(screenX, canvas.height);
        ctx.stroke();
    }
    
    // Draw horizontal lines
    for (let y = startY; y <= worldEndY; y += gridSize) {
        const screenY = y + canvasOffset.y;
        ctx.beginPath();
        ctx.moveTo(0, screenY);
        ctx.lineTo(canvas.width, screenY);
        ctx.stroke();
    }
}

// Snap a coordinate to the grid
function snapToGrid(value) {
    const gridSize = 96; // 1 inch in pixels
    return Math.round(value / gridSize) * gridSize;
}

// Calculate relative luminance of a color (based on WCAG formula)
// Returns a value between 0 (black) and 1 (white)
function getRelativeLuminance(r, g, b) {
    // Convert RGB values to relative luminance
    const [rs, gs, bs] = [r, g, b].map(val => {
        val = val / 255;
        return val <= 0.03928 ? val / 12.92 : Math.pow((val + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

// Convert hex color to RGB
function hexToRgb(hex) {
    // Remove # if present
    hex = hex.replace('#', '');
    
    // Handle 3-digit hex codes
    if (hex.length === 3) {
        hex = hex.split('').map(char => char + char).join('');
    }
    
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    
    return { r, g, b };
}

// Get contrast color (black or white) based on background color
// Similar to CSS contrast-color() function
function getContrastColor(backgroundColor) {
    // Parse the color - handle hex, rgb(), rgba(), and named colors
    let rgb;
    
    if (backgroundColor.startsWith('#')) {
        rgb = hexToRgb(backgroundColor);
    } else if (backgroundColor.startsWith('rgb')) {
        // Parse rgb() or rgba() format
        const matches = backgroundColor.match(/\d+/g);
        if (matches && matches.length >= 3) {
            rgb = { r: parseInt(matches[0]), g: parseInt(matches[1]), b: parseInt(matches[2]) };
        } else {
            // Fallback to black if parsing fails
            return '#000000';
        }
    } else {
        // Try to parse as hex (might not have #)
        try {
            rgb = hexToRgb(backgroundColor);
        } catch {
            // Fallback: assume it's a named color and use black
            // For simplicity, we'll return white as a safe default
            return '#FFFFFF';
        }
    }
    
    // Calculate relative luminance
    const luminance = getRelativeLuminance(rgb.r, rgb.g, rgb.b);
    
    // If luminance is greater than 0.5 (midpoint), use black text, otherwise use white
    // This threshold can be adjusted based on preference (WCAG uses 0.5 as a common threshold)
    return luminance > 0.5 ? '#000000' : '#FFFFFF';
}

// Draw resize handles and outline box for a selected object
function drawResizeHandles(shape) {
    const bounds = shape.getBounds();
    const padding = 20; // Padding around the object - large enough to avoid overlap with connection edge zones
    const screenX = bounds.x + canvasOffset.x - padding;
    const screenY = bounds.y + canvasOffset.y - padding;
    const boxWidth = bounds.width + (padding * 2);
    const boxHeight = bounds.height + (padding * 2);
    
    // Draw outline box (bigger than the object)
    ctx.strokeStyle = '#48bb78';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(screenX, screenY, boxWidth, boxHeight);
    ctx.setLineDash([]);
    
    // For text objects, only draw corner handles; for others, draw all 8 handles
    let handles;
    if (shape instanceof TextObject) {
        handles = {
            'nw': { x: screenX, y: screenY },
            'ne': { x: screenX + boxWidth, y: screenY },
            'se': { x: screenX + boxWidth, y: screenY + boxHeight },
            'sw': { x: screenX, y: screenY + boxHeight }
        };
    } else {
        // Draw resize handles at the corners and midpoints of the padded outline box
        handles = {
            'nw': { x: screenX, y: screenY },
            'n': { x: screenX + boxWidth / 2, y: screenY },
            'ne': { x: screenX + boxWidth, y: screenY },
            'e': { x: screenX + boxWidth, y: screenY + boxHeight / 2 },
            'se': { x: screenX + boxWidth, y: screenY + boxHeight },
            's': { x: screenX + boxWidth / 2, y: screenY + boxHeight },
            'sw': { x: screenX, y: screenY + boxHeight },
            'w': { x: screenX, y: screenY + boxHeight / 2 }
        };
    }
    
    // Store padded handles on shape temporarily for detection
    shape._paddedResizeHandles = handles;
    
    ctx.fillStyle = '#48bb78';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    
    for (const handlePos of Object.values(handles)) {
        ctx.beginPath();
        ctx.arc(handlePos.x, handlePos.y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    }
}

// Draw all objects
function draw(mouseX = null, mouseY = null) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw grid background first
    drawGrid();
    
    // Draw connections first (behind shapes)
    connections.forEach(conn => conn.draw());
    
    // Draw all boxes with edge highlighting
    boxes.forEach(box => {
        let highlightEdge = null;
        // Highlight when hovering over edge
        if (mouseX !== null && mouseY !== null) {
            // Use better edge detection during connection creation
            if (pendingEdgeSelection) {
                const hoveredEdge = box.getBestEdgeForConnection(mouseX, mouseY);
                if (hoveredEdge) {
                    highlightEdge = hoveredEdge;
                }
            } else if (box.contains(mouseX, mouseY)) {
            const hoveredEdge = box.getEdgeAt(mouseX, mouseY);
            if (hoveredEdge) {
                highlightEdge = hoveredEdge;
                }
            }
        }
        // Highlight selected edge
        if (pendingEdgeSelection && box === pendingEdgeSelection.shape) {
            highlightEdge = pendingEdgeSelection.edge;
        }
        box.draw(selectedShapes.has(box));
        // Draw edge highlight
        if (highlightEdge) {
            const edgePoint = box.getEdgePoint(highlightEdge);
            ctx.fillStyle = '#48bb78';
            ctx.beginPath();
            ctx.arc(edgePoint.x + canvasOffset.x, edgePoint.y + canvasOffset.y, 6, 0, Math.PI * 2);
            ctx.fill();
        }
        // Draw resize handles if selected
        if (selectedShapes.has(box) && selectedShapes.size === 1) {
            // If this box is in a group, draw handles around the entire group
            if (box.isGroupResize()) {
                const groupBounds = box.getGroupBounds();
                // Create a temporary box-like object for drawing handles
                const groupBox = {
                    getBounds: () => groupBounds
                };
                drawResizeHandles(groupBox);
            } else {
                drawResizeHandles(box);
            }
        }
    });
    
    // Draw all circles with edge highlighting
    circles.forEach(circle => {
        let highlightEdge = null;
        // Highlight when hovering over edge
        if (mouseX !== null && mouseY !== null) {
            // Use better edge detection during connection creation
            if (pendingEdgeSelection) {
                const hoveredEdge = circle.getBestEdgeForConnection(mouseX, mouseY);
                if (hoveredEdge) {
                    highlightEdge = hoveredEdge;
                }
            } else if (circle.contains(mouseX, mouseY)) {
            const hoveredEdge = circle.getEdgeAt(mouseX, mouseY);
            if (hoveredEdge) {
                highlightEdge = hoveredEdge;
                }
            }
        }
        // Highlight selected edge
        if (pendingEdgeSelection && circle === pendingEdgeSelection.shape) {
            highlightEdge = pendingEdgeSelection.edge;
        }
        circle.draw(selectedShapes.has(circle));
        // Draw edge highlight
        if (highlightEdge) {
            const edgePoint = circle.getEdgePoint(highlightEdge);
            ctx.fillStyle = '#48bb78';
            ctx.beginPath();
            ctx.arc(edgePoint.x + canvasOffset.x, edgePoint.y + canvasOffset.y, 6, 0, Math.PI * 2);
            ctx.fill();
        }
        // Draw resize handles if selected
        if (selectedShapes.has(circle) && selectedShapes.size === 1) {
            drawResizeHandles(circle);
        }
    });
    
    // Draw all text objects
    textObjects.forEach(textObj => {
        textObj.draw(selectedShapes.has(textObj));
        // Draw resize handles if selected
        if (selectedShapes.has(textObj) && selectedShapes.size === 1) {
            drawResizeHandles(textObj);
        }
    });
    
    // Draw pending connection preview
    if (pendingEdgeSelection && tempConnectionEnd) {
        const fromPoint = pendingEdgeSelection.shape.getEdgePoint(pendingEdgeSelection.edge);
        const fromScreenX = fromPoint.x + canvasOffset.x;
        const fromScreenY = fromPoint.y + canvasOffset.y;
        ctx.strokeStyle = '#667eea';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(fromScreenX, fromScreenY);
        ctx.lineTo(tempConnectionEnd.x, tempConnectionEnd.y);
        ctx.stroke();
        ctx.setLineDash([]);
    }
    
    // Draw box split preview
    if (splitPreviewBox && splitPreviewDirection && splitPreviewSide) {
        const box = splitPreviewBox;
        const screenX = box.x + canvasOffset.x;
        const screenY = box.y + canvasOffset.y;
        
        // Calculate a contrasting overlay color based on the box's background color
        const contrastColor = getContrastColor(box.color);
        const rgb = hexToRgb(contrastColor);
        // Use the contrasting color with some transparency for the overlay
        ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.3)`;
        
        // Draw overlay on the side that will get the new box
        if (splitPreviewDirection === 'horizontal') {
            if (splitPreviewSide === 'top') {
                ctx.fillRect(screenX, screenY, box.width, box.height / 2);
            } else {
                ctx.fillRect(screenX, screenY + box.height / 2, box.width, box.height / 2);
            }
        } else {
            if (splitPreviewSide === 'left') {
                ctx.fillRect(screenX, screenY, box.width / 2, box.height);
            } else {
                ctx.fillRect(screenX + box.width / 2, screenY, box.width / 2, box.height);
            }
        }
        
        // Draw split line using the contrasting color
        ctx.strokeStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.8)`;
        ctx.lineWidth = 3;
        ctx.setLineDash([8, 4]);
        
        if (splitPreviewDirection === 'horizontal') {
            // Draw horizontal split line (widthwise)
            const splitY = screenY + box.height / 2;
            ctx.beginPath();
            ctx.moveTo(screenX, splitY);
            ctx.lineTo(screenX + box.width, splitY);
            ctx.stroke();
        } else {
            // Draw vertical split line (lengthwise)
            const splitX = screenX + box.width / 2;
            ctx.beginPath();
            ctx.moveTo(splitX, screenY);
            ctx.lineTo(splitX, screenY + box.height);
            ctx.stroke();
        }
        
        ctx.setLineDash([]);
    }
    
    // Highlight selected connections
    selectedConnections.forEach(conn => {
        const fromPoint = conn.fromShape.getEdgePoint(conn.fromEdge);
        const toPoint = conn.toShape.getEdgePoint(conn.toEdge);
        const fromScreenX = fromPoint.x + canvasOffset.x;
        const fromScreenY = fromPoint.y + canvasOffset.y;
        const toScreenX = toPoint.x + canvasOffset.x;
        const toScreenY = toPoint.y + canvasOffset.y;
        ctx.strokeStyle = '#667eea';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(fromScreenX, fromScreenY);
        ctx.lineTo(toScreenX, toScreenY);
        ctx.stroke();
        // Redraw connection on top
        conn.draw();
    });
    
    // Highlight single selected connection (for backward compatibility)
    if (selectedConnection && !selectedConnections.has(selectedConnection)) {
        const fromPoint = selectedConnection.fromShape.getEdgePoint(selectedConnection.fromEdge);
        const toPoint = selectedConnection.toShape.getEdgePoint(selectedConnection.toEdge);
        const fromScreenX = fromPoint.x + canvasOffset.x;
        const fromScreenY = fromPoint.y + canvasOffset.y;
        const toScreenX = toPoint.x + canvasOffset.x;
        const toScreenY = toPoint.y + canvasOffset.y;
        ctx.strokeStyle = '#667eea';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(fromScreenX, fromScreenY);
        ctx.lineTo(toScreenX, toScreenY);
        ctx.stroke();
        // Redraw connection on top
        selectedConnection.draw();
    }
    
    // Draw active lasso selection (while drawing)
    if (isLassoActive && lassoPoints.length > 1) {
        ctx.strokeStyle = '#667eea';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(lassoPoints[0].x, lassoPoints[0].y);
        for (let i = 1; i < lassoPoints.length; i++) {
            ctx.lineTo(lassoPoints[i].x, lassoPoints[i].y);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.setLineDash([]);
    }
    
    // Draw completed lasso selection with blinking effect
    if (completedLassoPoints && completedLassoPoints.length > 2 && currentTool === 'lasso') {
        // Blinking effect: opacity oscillates gently between 0.7 and 1.0
        const opacity = 0.7 + (Math.sin(lassoBlinkAnimation) + 1) / 2 * 0.3;
        ctx.strokeStyle = `rgba(102, 126, 234, ${opacity})`;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(completedLassoPoints[0].x, completedLassoPoints[0].y);
        for (let i = 1; i < completedLassoPoints.length; i++) {
            ctx.lineTo(completedLassoPoints[i].x, completedLassoPoints[i].y);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.setLineDash([]);
    }
}

// Tool selection
selectTool.addEventListener('click', () => {
    currentTool = 'select';
    updateToolButtons();
    canvas.style.cursor = 'default';
    // Clear completed lasso when switching away from lasso tool
    completedLassoPoints = null;
    draw();
});

lassoTool.addEventListener('click', () => {
    currentTool = 'lasso';
    updateToolButtons();
    canvas.style.cursor = 'crosshair';
    // Clear completed lasso when switching to lasso tool
    completedLassoPoints = null;
    draw();
});

function updateToolButtons() {
    document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active'));
    if (currentTool === 'select') selectTool.classList.add('active');
    if (currentTool === 'lasso') lassoTool.classList.add('active');
}

// Color picker
colorPicker.addEventListener('change', (e) => {
    currentColor = e.target.value;
    // Update color of selected objects
    selectedShapes.forEach(shape => {
        if (shape instanceof Box || shape instanceof Circle) {
            shape.color = currentColor;
        } else if (shape instanceof TextObject) {
            shape.textColor = currentColor;
        }
    });
    // Update color of selected connections
    selectedConnections.forEach(conn => {
        conn.color = currentColor;
    });
    // Update color of single selected connection (for backward compatibility)
    if (selectedConnection && !selectedConnections.has(selectedConnection)) {
        selectedConnection.color = currentColor;
    }
    draw();
});

// Drag and drop from toolbar
// Drag and drop handlers
draggableBox.addEventListener('dragstart', (e) => {
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('shapeType', 'box');
    draggedShapeType = 'box';
    draggableBox.classList.add('dragging');
});

draggableBox.addEventListener('dragend', () => {
    draggableBox.classList.remove('dragging');
    draggedShapeType = null;
    splitPreviewBox = null;
    splitPreviewDirection = null;
    splitPreviewSide = null;
    draw();
});

draggableCircle.addEventListener('dragstart', (e) => {
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('shapeType', 'circle');
    draggableCircle.classList.add('dragging');
});

draggableCircle.addEventListener('dragend', () => {
    draggableCircle.classList.remove('dragging');
});

draggableText.addEventListener('dragstart', (e) => {
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('shapeType', 'text');
    draggableText.classList.add('dragging');
});

draggableText.addEventListener('dragend', () => {
    draggableText.classList.remove('dragging');
});

// Shift-click handlers for multiple placement
draggableBox.addEventListener('click', (e) => {
    if (e.shiftKey) {
        e.preventDefault();
        selectedShapeTypeForPlacement = 'box';
        canvas.style.cursor = 'crosshair';
    }
});

draggableCircle.addEventListener('click', (e) => {
    if (e.shiftKey) {
        e.preventDefault();
        selectedShapeTypeForPlacement = 'circle';
        canvas.style.cursor = 'crosshair';
    }
});

draggableText.addEventListener('click', (e) => {
    if (e.shiftKey) {
        e.preventDefault();
        selectedShapeTypeForPlacement = 'text';
        canvas.style.cursor = 'crosshair';
    }
});

canvasContainer.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    canvasContainer.classList.add('drag-over');
    
    // Check if dragging a box over an existing box for split preview
    if (draggedShapeType === 'box') {
        const rect = canvas.getBoundingClientRect();
        const dropX = e.clientX - rect.left;
        const dropY = e.clientY - rect.top;
        
        // Find box being hovered over
        let hoveredBox = null;
        for (const box of boxes) {
            if (box.contains(dropX, dropY)) {
                hoveredBox = box;
                break;
            }
        }
        
        if (hoveredBox) {
            splitPreviewBox = hoveredBox;
            // Determine split direction and which side based on mouse position
            const worldX = dropX - canvasOffset.x;
            const worldY = dropY - canvasOffset.y;
            const centerX = hoveredBox.x + hoveredBox.width / 2;
            const centerY = hoveredBox.y + hoveredBox.height / 2;
            const relativeX = worldX - centerX;
            const relativeY = worldY - centerY;
            const isHorizontalSplit = Math.abs(relativeY) > Math.abs(relativeX);
            
            if (isHorizontalSplit) {
                splitPreviewDirection = 'horizontal';
                splitPreviewSide = relativeY < 0 ? 'top' : 'bottom';
            } else {
                splitPreviewDirection = 'vertical';
                splitPreviewSide = relativeX < 0 ? 'left' : 'right';
            }
        } else {
            splitPreviewBox = null;
            splitPreviewDirection = null;
            splitPreviewSide = null;
        }
        draw();
    } else {
        splitPreviewBox = null;
        splitPreviewDirection = null;
        splitPreviewSide = null;
    }
});

canvasContainer.addEventListener('dragleave', () => {
    canvasContainer.classList.remove('drag-over');
    splitPreviewBox = null;
    splitPreviewDirection = null;
    splitPreviewSide = null;
    draw();
});

canvasContainer.addEventListener('drop', (e) => {
    e.preventDefault();
    canvasContainer.classList.remove('drag-over');
    
    // Clear split preview
    splitPreviewBox = null;
    splitPreviewDirection = null;
    splitPreviewSide = null;
    draggedShapeType = null;
    
    const shapeType = e.dataTransfer.getData('shapeType');
    const rect = canvas.getBoundingClientRect();
    const dropX = e.clientX - rect.left;
    const dropY = e.clientY - rect.top;
    const worldX = dropX - canvasOffset.x;
    const worldY = dropY - canvasOffset.y;
    
    if (shapeType === 'circle') {
        circles.push(new Circle(worldX - 40, worldY - 40));
    } else if (shapeType === 'box') {
        // Check if dropping on top of an existing box
        let targetBox = null;
        for (const box of boxes) {
            if (box.contains(dropX, dropY)) {
                targetBox = box;
                break;
            }
        }
        
        if (targetBox) {
            // Split the box
            const centerX = targetBox.x + targetBox.width / 2;
            const centerY = targetBox.y + targetBox.height / 2;
            
            // Determine split direction and which side the mouse is on
            const relativeX = worldX - centerX;
            const relativeY = worldY - centerY;
            const isHorizontalSplit = Math.abs(relativeY) > Math.abs(relativeX);
            
            // Generate a unique group ID for these split boxes
            const groupId = Date.now() + Math.random();
            
            let box1, box2;
            
            if (isHorizontalSplit) {
                // Split horizontally (widthwise) - top and bottom boxes
                const halfHeight = targetBox.height / 2;
                const isTopSide = relativeY < 0; // Mouse is in top half
                
                if (isTopSide) {
                    // New box on top, original on bottom
                    box1 = new Box(targetBox.x, targetBox.y);
                    box1.width = targetBox.width;
                    box1.height = halfHeight;
                    box1.color = currentColor; // New color from picker
                    box1.text = ''; // Empty text
                    box1.groupId = groupId;
                    
                    box2 = new Box(targetBox.x, targetBox.y + halfHeight);
                    box2.width = targetBox.width;
                    box2.height = halfHeight;
                    box2.color = targetBox.color;
                    box2.text = targetBox.text;
                    box2.groupId = groupId;
                    
                    // Create connection: top box to bottom box
                    const connection = new Connection(box1, 'bottom', box2, 'top', 'both', currentColor);
                    connections.push(connection);
    } else {
                    // New box on bottom, original on top (original behavior)
                    box1 = new Box(targetBox.x, targetBox.y);
                    box1.width = targetBox.width;
                    box1.height = halfHeight;
                    box1.color = targetBox.color;
                    box1.text = targetBox.text;
                    box1.groupId = groupId;
                    
                    box2 = new Box(targetBox.x, targetBox.y + halfHeight);
                    box2.width = targetBox.width;
                    box2.height = halfHeight;
                    box2.color = currentColor; // New color from picker
                    box2.text = ''; // Empty text
                    box2.groupId = groupId;
                    
                    // Create connection: top box to bottom box
                    const connection = new Connection(box1, 'bottom', box2, 'top', 'both', currentColor);
                    connections.push(connection);
                }
                
                // Remove original box
                const index = boxes.indexOf(targetBox);
                boxes.splice(index, 1);
                
                // Add new boxes
                boxes.push(box1, box2);
            } else {
                // Split vertically (lengthwise) - left and right boxes
                const halfWidth = targetBox.width / 2;
                const isLeftSide = relativeX < 0; // Mouse is in left half
                
                if (isLeftSide) {
                    // New box on left, original on right
                    box1 = new Box(targetBox.x, targetBox.y);
                    box1.width = halfWidth;
                    box1.height = targetBox.height;
                    box1.color = currentColor; // New color from picker
                    box1.text = ''; // Empty text
                    box1.groupId = groupId;
                    
                    box2 = new Box(targetBox.x + halfWidth, targetBox.y);
                    box2.width = halfWidth;
                    box2.height = targetBox.height;
                    box2.color = targetBox.color;
                    box2.text = targetBox.text;
                    box2.groupId = groupId;
                    
                    // Create connection: left box to right box
                    const connection = new Connection(box1, 'right', box2, 'left', 'both', currentColor);
                    connections.push(connection);
                } else {
                    // New box on right, original on left (original behavior)
                    box1 = new Box(targetBox.x, targetBox.y);
                    box1.width = halfWidth;
                    box1.height = targetBox.height;
                    box1.color = targetBox.color;
                    box1.text = targetBox.text;
                    box1.groupId = groupId;
                    
                    box2 = new Box(targetBox.x + halfWidth, targetBox.y);
                    box2.width = halfWidth;
                    box2.height = targetBox.height;
                    box2.color = currentColor; // New color from picker
                    box2.text = ''; // Empty text
                    box2.groupId = groupId;
                    
                    // Create connection: left box to right box
                    const connection = new Connection(box1, 'right', box2, 'left', 'both', currentColor);
                    connections.push(connection);
                }
                
                // Remove original box
                const index = boxes.indexOf(targetBox);
                boxes.splice(index, 1);
                
                // Add new boxes
                boxes.push(box1, box2);
            }
        } else {
            // Normal box placement
            boxes.push(new Box(worldX - 40, worldY - 40));
        }
    } else if (shapeType === 'text') {
        const textObj = new TextObject(worldX - 40, worldY - 40);
        textObjects.push(textObj);
        selectedShapes.clear();
        selectedShapes.add(textObj);
        // Automatically start editing the text after placement
        startEditingText(textObj);
    }
    draw();
});

// Helper function to place a shape at the given position (centered on click)
function placeShapeAt(shapeType, x, y) {
    // Convert screen coordinates to world coordinates
    let worldX = x - canvasOffset.x;
    let worldY = y - canvasOffset.y;
    
    // Center the shape on the click position
    if (shapeType === 'circle' || shapeType === 'box') {
        // Both box and circle are 80x80, so center offset is -40
        worldX -= 40;
        worldY -= 40;
    }
    // Text objects don't need centering - they start at the click position
    
    if (shapeType === 'circle') {
        circles.push(new Circle(worldX, worldY));
    } else if (shapeType === 'box') {
        boxes.push(new Box(worldX, worldY));
    } else if (shapeType === 'text') {
        const textObj = new TextObject(worldX, worldY);
        textObjects.push(textObj);
        selectedShapes.clear();
        selectedShapes.add(textObj);
        // Automatically start editing the text after placement
        startEditingText(textObj);
    }
    draw();
}

// Canvas mouse events
canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Check for shift-click placement mode
    if (selectedShapeTypeForPlacement && e.shiftKey && e.button === 0) {
        placeShapeAt(selectedShapeTypeForPlacement, x, y);
        return;
    }
    
    if (currentTool === 'lasso') {
        // FIRST check if clicking within completed lasso shape - this must happen before starting new lasso
        if (completedLassoPoints && completedLassoPoints.length > 2 && isPointInPolygon(x, y, completedLassoPoints)) {
            // Clicked within completed lasso - allow dragging selected objects
            if (selectedShapes.size > 0 || selectedConnections.size > 0) {
                isDragging = true;
                dragStartPos.x = x;
                dragStartPos.y = y;
                // Store initial positions of all selected shapes
                dragStartShapes = Array.from(selectedShapes).map(shape => ({
                    shape: shape,
                    x: shape.x,
                    y: shape.y
                }));
                // Store initial lasso points so we can move them with the objects
                dragStartLassoPoints = completedLassoPoints.map(point => ({ x: point.x, y: point.y }));
                canvas.style.cursor = 'grabbing';
                draw(x, y);
                return; // Important: return here to prevent starting new lasso
            }
            // If clicking within lasso but nothing selected, don't start new lasso - just return
            return;
        }
        // Only start new lasso selection if clicking outside completed lasso
        // Clear previous completed lasso
        completedLassoPoints = null;
        isLassoActive = true;
        lassoPoints = [{ x, y }];
        if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
            selectedShapes.clear();
            selectedConnections.clear();
        }
        return;
    }
    
    // Select tool or pan
    if (e.button === 0) { // Left click
    // First check if clicking on a connection
    const clickedConnection = connections.find(conn => conn.isPointNear(x, y));
        if (clickedConnection && currentTool === 'select') {
        // Clicked on a connection - allow editing
            if (e.shiftKey || e.ctrlKey || e.metaKey) {
                // Multi-select
                if (selectedConnections.has(clickedConnection)) {
                    selectedConnections.delete(clickedConnection);
                } else {
                    selectedConnections.add(clickedConnection);
                }
                selectedConnection = null; // Clear single selection when multi-selecting
            } else {
                // Single select
        selectedConnection = clickedConnection;
                selectedConnections.clear();
        // Clear shape selection when selecting a connection
                selectedShapes.clear();
        showArrowDirectionPanelForConnection(clickedConnection);
            }
            draw(x, y);
        return;
    }
    
    // Check for resize handle clicks (only when single object is selected)
    if (currentTool === 'select' && selectedShapes.size === 1) {
        const selectedShape = Array.from(selectedShapes)[0];
        if (selectedShape instanceof Box || selectedShape instanceof Circle || selectedShape instanceof TextObject) {
            let handle = null;
            let bounds = null;
            
            // If it's a box in a group, check for group resize handles
            if (selectedShape instanceof Box && selectedShape.isGroupResize()) {
                const groupBounds = selectedShape.getGroupBounds();
                const padding = 20;
                const screenX = groupBounds.x + canvasOffset.x - padding;
                const screenY = groupBounds.y + canvasOffset.y - padding;
                const boxWidth = groupBounds.width + (padding * 2);
                const boxHeight = groupBounds.height + (padding * 2);
                
                const handles = {
                    'nw': { x: screenX, y: screenY },
                    'n': { x: screenX + boxWidth / 2, y: screenY },
                    'ne': { x: screenX + boxWidth, y: screenY },
                    'e': { x: screenX + boxWidth, y: screenY + boxHeight / 2 },
                    'se': { x: screenX + boxWidth, y: screenY + boxHeight },
                    's': { x: screenX + boxWidth / 2, y: screenY + boxHeight },
                    'sw': { x: screenX, y: screenY + boxHeight },
                    'w': { x: screenX, y: screenY + boxHeight / 2 }
                };
                
                for (const [handleName, handlePos] of Object.entries(handles)) {
                    const dx = x - handlePos.x;
                    const dy = y - handlePos.y;
                    if (Math.abs(dx) <= 8 && Math.abs(dy) <= 8) {
                        handle = handleName;
                        bounds = groupBounds;
                        break;
                    }
                }
            } else {
                // Normal resize handle check
                handle = selectedShape.getResizeHandleAt(x, y);
                if (handle) {
                    bounds = selectedShape.getBounds();
                }
            }
            
            if (handle) {
                isResizing = true;
                resizeHandle = handle;
                resizeStartPos.x = x;
                resizeStartPos.y = y;
                resizeStartShape = selectedShape;
                resizeStartBounds = {
                    x: bounds.x,
                    y: bounds.y,
                    width: bounds.width,
                    height: bounds.height
                };
                
                // Store original states of all boxes in the group if it's a group resize
                if (selectedShape instanceof Box && selectedShape.isGroupResize()) {
                    const group = selectedShape.getGroup();
                    resizeStartBoxStates = Array.from(group).map(box => ({
                        x: box.x,
                        y: box.y,
                        width: box.width,
                        height: box.height
                    }));
                } else {
                    resizeStartBoxStates = [];
                }
                
                draw(x, y);
                return;
            }
        }
    }
    
        // Check if clicking on an edge (only for boxes and circles, only with select tool)
    let clickedShape = null;
    let clickedEdge = null;
        
        if (currentTool === 'select') {
            // Use better edge detection during connection creation (when first anchor is set)
            const useConnectionMode = pendingEdgeSelection !== null;
    
    // Check boxes first
    for (const box of boxes) {
                if (useConnectionMode) {
                    // During connection creation, use larger detection zones
                    clickedEdge = box.getBestEdgeForConnection(x, y);
                    if (clickedEdge) {
                        clickedShape = box;
                        break;
                    }
                } else {
                    // Normal mode - check if clicking on edge
        if (box.contains(x, y)) {
            clickedEdge = box.getEdgeAt(x, y);
            if (clickedEdge) {
                clickedShape = box;
                break;
                        }
            }
        }
    }
    
    // Note: Boxes in groups can be selected individually - no special handling needed here
    
    // Check circles if no box edge found
    if (!clickedShape) {
        for (const circle of circles) {
                    if (useConnectionMode) {
                        // During connection creation, use larger detection zones
                        clickedEdge = circle.getBestEdgeForConnection(x, y);
                        if (clickedEdge) {
                            clickedShape = circle;
                            break;
                        }
                    } else {
                        // Normal mode - check if clicking on edge
            if (circle.contains(x, y)) {
                clickedEdge = circle.getEdgeAt(x, y);
                if (clickedEdge) {
                    clickedShape = circle;
                    break;
                            }
                        }
                }
            }
        }
    }
    
    if (clickedShape && clickedEdge) {
        // Edge clicked - clear shape selection when clicking on edge
            selectedShapes.clear();
            selectedConnection = null;
        if (!pendingEdgeSelection) {
            // First edge selected
            pendingEdgeSelection = { shape: clickedShape, edge: clickedEdge };
            tempConnectionEnd = { x, y };
        } else {
            // Second edge selected
            if (clickedShape !== pendingEdgeSelection.shape || clickedEdge !== pendingEdgeSelection.edge) {
                // Different shape or different edge - show arrow direction panel
                waitingForArrowSelection = true;
                tempConnectionEnd = clickedShape.getEdgePoint(clickedEdge);
                showArrowDirectionPanel(pendingEdgeSelection, clickedShape, clickedEdge);
            } else {
                // Same shape and same edge - allow creating another connection from this edge
                tempConnectionEnd = { x, y };
            }
        }
            draw(x, y);
        return;
    }
    
        // Check if clicking on an object (not edge)
        let clickedObject = null;
        
        // Check in reverse order (top to bottom)
        for (let i = textObjects.length - 1; i >= 0; i--) {
            if (textObjects[i].contains(x, y)) {
                clickedObject = textObjects[i];
            break;
        }
    }
        if (!clickedObject) {
            for (let i = circles.length - 1; i >= 0; i--) {
                if (circles[i].contains(x, y)) {
                    clickedObject = circles[i];
                    break;
                }
            }
        }
        if (!clickedObject) {
            for (let i = boxes.length - 1; i >= 0; i--) {
                if (boxes[i].contains(x, y)) {
                    clickedObject = boxes[i];
                break;
            }
        }
    }
    
        if (clickedObject) {
        // Cancel edge selection if clicking on shape center
        pendingEdgeSelection = null;
        tempConnectionEnd = null;
            waitingForArrowSelection = false;
            if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
        selectedConnection = null;
                selectedConnections.clear();
            }
        arrowDirectionPanel.style.display = 'none';
            // Handle selection
            if (e.shiftKey || e.ctrlKey || e.metaKey) {
                // Multi-select
                if (selectedShapes.has(clickedObject)) {
                    selectedShapes.delete(clickedObject);
                } else {
                    selectedShapes.add(clickedObject);
                }
            } else {
                // Single select - boxes can be selected individually even if in a group
                selectedShapes.clear();
                selectedShapes.add(clickedObject);
            }
            
        isDragging = true;
            dragStartPos.x = x;
            dragStartPos.y = y;
            // Store initial positions of all selected shapes
            dragStartShapes = Array.from(selectedShapes).map(shape => ({
                shape: shape,
                x: shape.x,
                y: shape.y
            }));
            dragOffset.x = x - canvasOffset.x - clickedObject.x;
            dragOffset.y = y - canvasOffset.y - clickedObject.y;
            
            // Adjust drag offset for circles
            if (clickedObject instanceof Circle) {
                dragOffset.x -= clickedObject.radiusX;
                dragOffset.y -= clickedObject.radiusY;
            }
            
        canvas.style.cursor = 'grabbing';
    } else {
        // Clicked outside, hide editor if visible and cancel edge selection
            hideTextEditor();
        pendingEdgeSelection = null;
        tempConnectionEnd = null;
        waitingForArrowSelection = false;
            if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
        selectedConnection = null;
                selectedConnections.clear();
            }
        arrowDirectionPanel.style.display = 'none';
            
            // Start panning
            if (currentTool === 'select') {
                isPanning = true;
                panStart.x = x;
                panStart.y = y;
                panOffset.x = canvasOffset.x;
                panOffset.y = canvasOffset.y;
                canvas.style.cursor = 'grab';
            }
            // Clear selection if not holding shift/ctrl
            if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
                selectedShapes.clear();
            }
        }
        draw(x, y);
    }
});

canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    if (isLassoActive) {
        lassoPoints.push({ x, y });
        draw();
        return;
    }
    
    // Check for edge selection preview
    if (pendingEdgeSelection && !waitingForArrowSelection) {
        tempConnectionEnd = { x, y };
        draw(x, y);
        return;
    }
    
    // Check if hovering over connection
    if (currentTool === 'select') {
    const hoveringConnection = connections.find(conn => conn.isPointNear(x, y));
    if (hoveringConnection) {
        canvas.style.cursor = 'pointer';
        draw(x, y);
        return;
        }
    }
    
    if (isPanning) {
        canvasOffset.x = panOffset.x + (x - panStart.x);
        canvasOffset.y = panOffset.y + (y - panStart.y);
        draw(x, y);
        return;
    }
    
    // Handle resizing
    if (isResizing && resizeStartShape) {
        const deltaX = (x - resizeStartPos.x);
        const deltaY = (y - resizeStartPos.y);
        const handle = resizeHandle;
        
        if (resizeStartShape instanceof Box) {
            // Check if this is a group resize
            if (resizeStartShape.isGroupResize()) {
                // Resize the entire group as a rectangle
                const group = resizeStartShape.getGroup();
                
                let newX = resizeStartBounds.x;
                let newY = resizeStartBounds.y;
                let newWidth = resizeStartBounds.width;
                let newHeight = resizeStartBounds.height;
                
                // Adjust based on which handle is being dragged
                if (handle.includes('w')) {
                    newX += deltaX;
                    newWidth -= deltaX;
                }
                if (handle.includes('e')) {
                    newWidth += deltaX;
                }
                if (handle.includes('n')) {
                    newY += deltaY;
                    newHeight -= deltaY;
                }
                if (handle.includes('s')) {
                    newHeight += deltaY;
                }
                
                // Ensure minimum size
                if (newWidth < 40) {
                    if (handle.includes('w')) {
                        const diff = 40 - newWidth;
                        newX -= diff;
                        newWidth = 40;
    } else {
                        newWidth = 40;
                    }
                }
                if (newHeight < 40) {
                    if (handle.includes('n')) {
                        const diff = 40 - newHeight;
                        newY -= diff;
                        newHeight = 40;
                    } else {
                        newHeight = 40;
                    }
                }
                
                // Only proceed if we have valid dimensions
                if (newWidth > 0 && newHeight > 0 && resizeStartBoxStates.length > 0) {
                    // Calculate scale factors
                    const scaleX = resizeStartBounds.width > 0 ? newWidth / resizeStartBounds.width : 1;
                    const scaleY = resizeStartBounds.height > 0 ? newHeight / resizeStartBounds.height : 1;
                    
                    // Resize all boxes in the group proportionally using stored original states
                    const groupArray = Array.from(group);
                    groupArray.forEach((groupBox, index) => {
                        if (index < resizeStartBoxStates.length) {
                            const origState = resizeStartBoxStates[index];
                            
                            // Calculate relative position within the original group bounds
                            const relX = origState.x - resizeStartBounds.x;
                            const relY = origState.y - resizeStartBounds.y;
                            
                            // Apply scale and offset
                            groupBox.x = newX + relX * scaleX;
                            groupBox.y = newY + relY * scaleY;
                            groupBox.width = origState.width * scaleX;
                            groupBox.height = origState.height * scaleY;
                            
                            // Ensure minimum size
                            if (groupBox.width < 20) {
                                groupBox.width = 20;
                            }
                            if (groupBox.height < 20) {
                                groupBox.height = 20;
                            }
                        }
                    });
                }
            } else {
                // Normal single box resize
                let newX = resizeStartBounds.x;
                let newY = resizeStartBounds.y;
                let newWidth = resizeStartBounds.width;
                let newHeight = resizeStartBounds.height;
                
                // Adjust based on which handle is being dragged
                if (handle.includes('w')) {
                    newX += deltaX;
                    newWidth -= deltaX;
                }
                if (handle.includes('e')) {
                    newWidth += deltaX;
                }
                if (handle.includes('n')) {
                    newY += deltaY;
                    newHeight -= deltaY;
                }
                if (handle.includes('s')) {
                    newHeight += deltaY;
                }
                
                // Ensure minimum size
                if (newWidth < 20) {
                    if (handle.includes('w')) newX -= (20 - newWidth);
                    newWidth = 20;
                }
                if (newHeight < 20) {
                    if (handle.includes('n')) newY -= (20 - newHeight);
                    newHeight = 20;
                }
                
                resizeStartShape.x = newX;
                resizeStartShape.y = newY;
                resizeStartShape.width = newWidth;
                resizeStartShape.height = newHeight;
            }
        } else if (resizeStartShape instanceof Circle) {
            let newX = resizeStartBounds.x;
            let newY = resizeStartBounds.y;
            let newWidth = resizeStartBounds.width;
            let newHeight = resizeStartBounds.height;
            
            // Adjust based on which handle is being dragged
            if (handle.includes('w')) {
                newX += deltaX;
                newWidth -= deltaX;
            }
            if (handle.includes('e')) {
                newWidth += deltaX;
            }
            if (handle.includes('n')) {
                newY += deltaY;
                newHeight -= deltaY;
            }
            if (handle.includes('s')) {
                newHeight += deltaY;
            }
            
            // Ensure minimum size
            if (newWidth < 20) {
                if (handle.includes('w')) newX -= (20 - newWidth);
                newWidth = 20;
            }
            if (newHeight < 20) {
                if (handle.includes('n')) newY -= (20 - newHeight);
                newHeight = 20;
            }
            
            resizeStartShape.x = newX;
            resizeStartShape.y = newY;
            resizeStartShape.radiusX = newWidth / 2;
            resizeStartShape.radiusY = newHeight / 2;
            resizeStartShape.radius = Math.min(resizeStartShape.radiusX, resizeStartShape.radiusY); // For backward compatibility
        } else if (resizeStartShape instanceof TextObject) {
            // For text objects: only corner handles (nw, ne, sw, se)
            // Calculate new font size based on vertical distance (height)
            // Keep the opposite corner fixed
            let newX = resizeStartBounds.x;
            let newY = resizeStartBounds.y;
            let newHeight = resizeStartBounds.height;
            
            // Adjust based on which corner handle is being dragged
            if (handle === 'nw') {
                // Top-left corner - keep bottom-right fixed, adjust top-left
                newX += deltaX;
                newY += deltaY;
                newHeight -= deltaY;
            } else if (handle === 'ne') {
                // Top-right corner - keep bottom-left fixed, adjust top-right
                newY += deltaY;
                newHeight -= deltaY;
            } else if (handle === 'sw') {
                // Bottom-left corner - keep top-right fixed, adjust bottom-left
                newX += deltaX;
                newHeight += deltaY;
            } else if (handle === 'se') {
                // Bottom-right corner - keep top-left fixed, adjust bottom-right
                newHeight += deltaY;
            }
            
            // Ensure minimum font size
            if (newHeight < 10) {
                if (handle.includes('n')) {
                    const diff = 10 - newHeight;
                    newY -= diff;
                }
                newHeight = 10;
            }
            
            // Update text object
            resizeStartShape.x = newX;
            resizeStartShape.y = newY;
            resizeStartShape.fontSize = Math.max(10, Math.round(newHeight));
        }
        
        draw(x, y);
        return;
    }
    
    if (isDragging && (selectedShapes.size > 0 || selectedConnections.size > 0)) {
        // Calculate movement delta from initial click position (in screen coordinates)
        // Since shapes use world coordinates, we need to account for canvas offset
        const deltaX = x - dragStartPos.x;
        const deltaY = y - dragStartPos.y;
        
        // Move all selected shapes based on their initial positions
        dragStartShapes.forEach(({ shape, x: startX, y: startY }) => {
            if (selectedShapes.has(shape)) {
                // Calculate new position
                const newX = startX + deltaX;
                const newY = startY + deltaY;
                
                // If this is a box with a group, move all boxes in the group together
                if (shape instanceof Box && shape.groupId) {
                    const group = shape.getGroup();
                    const groupDeltaX = newX - shape.x;
                    const groupDeltaY = newY - shape.y;
                    
                    group.forEach(groupBox => {
                        groupBox.x += groupDeltaX;
                        groupBox.y += groupDeltaY;
                    });
                } else {
                    shape.x = newX;
                    shape.y = newY;
                }
                
                // Keep within reasonable bounds (optional)
                if (shape instanceof Circle) {
                    shape.x = Math.max(-shape.radiusX * 2, shape.x);
                    shape.y = Math.max(-shape.radiusY * 2, shape.y);
                } else if (shape instanceof Box) {
                    shape.x = Math.max(-shape.width, shape.x);
                    shape.y = Math.max(-shape.height, shape.y);
                }
            }
        });
        
        // Move the lasso shape with the objects
        if (dragStartLassoPoints && completedLassoPoints) {
            completedLassoPoints = dragStartLassoPoints.map(point => ({
                x: point.x + deltaX,
                y: point.y + deltaY
            }));
        }
        
        // Connections move automatically with their connected shapes, so no need to move them separately
        
        draw(x, y);
        return;
    }
    
    // Update cursor
    if (currentTool === 'lasso') {
        // Check if hovering over completed lasso with selected objects
        if (completedLassoPoints && completedLassoPoints.length > 2 && 
            isPointInPolygon(x, y, completedLassoPoints) && 
            (selectedShapes.size > 0 || selectedConnections.size > 0)) {
            canvas.style.cursor = 'grab';
    } else {
            canvas.style.cursor = 'crosshair';
        }
    } else {
        // Check if hovering over resize handle
        let hoveringResizeHandle = false;
        if (currentTool === 'select' && selectedShapes.size === 1) {
            const selectedShape = Array.from(selectedShapes)[0];
            if (selectedShape instanceof Box || selectedShape instanceof Circle || selectedShape instanceof TextObject) {
                let handle = null;
                
                // If it's a box in a group, check for group resize handles
                if (selectedShape instanceof Box && selectedShape.isGroupResize()) {
                    const groupBounds = selectedShape.getGroupBounds();
                    const padding = 20;
                    const screenX = groupBounds.x + canvasOffset.x - padding;
                    const screenY = groupBounds.y + canvasOffset.y - padding;
                    const boxWidth = groupBounds.width + (padding * 2);
                    const boxHeight = groupBounds.height + (padding * 2);
                    
                    const handles = {
                        'nw': { x: screenX, y: screenY },
                        'n': { x: screenX + boxWidth / 2, y: screenY },
                        'ne': { x: screenX + boxWidth, y: screenY },
                        'e': { x: screenX + boxWidth, y: screenY + boxHeight / 2 },
                        'se': { x: screenX + boxWidth, y: screenY + boxHeight },
                        's': { x: screenX + boxWidth / 2, y: screenY + boxHeight },
                        'sw': { x: screenX, y: screenY + boxHeight },
                        'w': { x: screenX, y: screenY + boxHeight / 2 }
                    };
                    
                    for (const [handleName, handlePos] of Object.entries(handles)) {
                        const dx = x - handlePos.x;
                        const dy = y - handlePos.y;
                        if (Math.abs(dx) <= 8 && Math.abs(dy) <= 8) {
                            handle = handleName;
                            break;
                        }
                    }
                } else {
                    // Normal resize handle check
                    handle = selectedShape.getResizeHandleAt(x, y);
                }
                
                if (handle) {
                    hoveringResizeHandle = true;
                    // Set cursor based on handle position
                    const cursorMap = {
                        'nw': 'nw-resize', 'n': 'n-resize', 'ne': 'ne-resize',
                        'e': 'e-resize', 'se': 'se-resize', 's': 's-resize',
                        'sw': 'sw-resize', 'w': 'w-resize'
                    };
                    canvas.style.cursor = cursorMap[handle] || 'default';
                    draw(x, y);
                    return;
                }
            }
        }
        
        // Check if hovering over edge
        let hoveringEdge = false;
        const useConnectionMode = pendingEdgeSelection !== null;
        
        for (const box of boxes) {
            if (useConnectionMode) {
                // During connection creation, use larger detection zones
                if (box.getBestEdgeForConnection(x, y)) {
                    hoveringEdge = true;
                    break;
                }
            } else {
            if (box.contains(x, y) && box.getEdgeAt(x, y)) {
                hoveringEdge = true;
                break;
                }
            }
        }
        if (!hoveringEdge) {
            for (const circle of circles) {
                if (useConnectionMode) {
                    // During connection creation, use larger detection zones
                    if (circle.getBestEdgeForConnection(x, y)) {
                        hoveringEdge = true;
                        break;
                    }
                } else {
                if (circle.contains(x, y) && circle.getEdgeAt(x, y)) {
                    hoveringEdge = true;
                    break;
                }
            }
        }
        }
        
        // Check if hovering over object
        let hovering = false;
        for (let i = textObjects.length - 1; i >= 0; i--) {
            if (textObjects[i].contains(x, y)) {
                hovering = true;
                break;
            }
        }
        if (!hovering) {
            for (let i = circles.length - 1; i >= 0; i--) {
                if (circles[i].contains(x, y)) {
                    hovering = true;
                    break;
                }
            }
        }
        if (!hovering) {
            for (let i = boxes.length - 1; i >= 0; i--) {
                if (boxes[i].contains(x, y)) {
                    hovering = true;
                    break;
                }
            }
        }
        canvas.style.cursor = hoveringEdge ? 'crosshair' : (hovering ? 'grab' : 'default');
    }
        
        // Pass mouse coordinates to draw so edges can be highlighted
        draw(x, y);
});

canvas.addEventListener('mouseup', (e) => {
    if (isLassoActive) {
        // Complete lasso selection
        if (lassoPoints.length > 2) {
            // Check which objects are inside the lasso
            const allObjects = [...boxes, ...circles, ...textObjects];
            allObjects.forEach(obj => {
                const bounds = obj.getBounds();
                // Convert object center to screen coordinates
                const screenX = bounds.x + bounds.width / 2 + canvasOffset.x;
                const screenY = bounds.y + bounds.height / 2 + canvasOffset.y;
                
                if (isPointInPolygon(screenX, screenY, lassoPoints)) {
                    if (e.shiftKey || e.ctrlKey || e.metaKey) {
                        if (selectedShapes.has(obj)) {
                            selectedShapes.delete(obj);
                        } else {
                            selectedShapes.add(obj);
                        }
                    } else {
                        selectedShapes.add(obj);
                    }
                }
            });
            
            // Check which connections are inside the lasso
            connections.forEach(conn => {
                // Check if the midpoint of the connection is within the lasso
                const fromPoint = conn.fromShape.getEdgePoint(conn.fromEdge);
                const toPoint = conn.toShape.getEdgePoint(conn.toEdge);
                const midX = (fromPoint.x + toPoint.x) / 2 + canvasOffset.x;
                const midY = (fromPoint.y + toPoint.y) / 2 + canvasOffset.y;
                
                if (isPointInPolygon(midX, midY, lassoPoints)) {
                    if (e.shiftKey || e.ctrlKey || e.metaKey) {
                        if (selectedConnections.has(conn)) {
                            selectedConnections.delete(conn);
                        } else {
                            selectedConnections.add(conn);
                        }
                    } else {
                        selectedConnections.add(conn);
                    }
                }
            });
        }
        // Store completed lasso shape
        if (lassoPoints.length > 2) {
            completedLassoPoints = [...lassoPoints];
        }
        isLassoActive = false;
        lassoPoints = [];
    draw();
    }
    
    isDragging = false;
    isPanning = false;
    isResizing = false;
    resizeHandle = null;
    resizeStartShape = null;
    resizeStartBoxStates = [];
    dragStartLassoPoints = null; // Reset lasso points reference
    canvas.style.cursor = currentTool === 'lasso' ? 'crosshair' : 'default';
});

canvas.addEventListener('mouseleave', () => {
    isDragging = false;
    isPanning = false;
    isResizing = false;
    resizeHandle = null;
    resizeStartShape = null;
    resizeStartBoxStates = [];
    dragStartLassoPoints = null; // Reset lasso points reference
    if (isLassoActive) {
        isLassoActive = false;
        lassoPoints = [];
        draw();
    }
});

// Point in polygon test for lasso selection
function isPointInPolygon(x, y, points) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const xi = points[i].x, yi = points[i].y;
        const xj = points[j].x, yj = points[j].y;
        const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

// Text editing
function startEditingText(textObj) {
    editingText = textObj;
    const rect = canvas.getBoundingClientRect();
    textEditor.value = textObj.text || '';
    textEditor.style.display = 'block';
    
    // Position editor based on object type
    if (textObj instanceof TextObject) {
        textEditor.style.left = (rect.left + textObj.x + canvasOffset.x) + 'px';
        textEditor.style.top = (rect.top + textObj.y + canvasOffset.y) + 'px';
        textEditor.style.width = '200px';
        textEditor.style.height = 'auto';
        textEditor.style.textAlign = 'left';
        textEditor.style.fontSize = '20px';
    } else if (textObj instanceof Box) {
        textEditor.style.left = (rect.left + textObj.x + canvasOffset.x) + 'px';
        textEditor.style.top = (rect.top + textObj.y + canvasOffset.y) + 'px';
        textEditor.style.width = textObj.width + 'px';
        textEditor.style.height = textObj.height + 'px';
        textEditor.style.textAlign = 'center';
        textEditor.style.fontSize = '16px';
        textEditor.style.lineHeight = textObj.height + 'px';
    } else if (textObj instanceof Circle) {
        textEditor.style.left = (rect.left + textObj.x + canvasOffset.x) + 'px';
        textEditor.style.top = (rect.top + textObj.y + canvasOffset.y) + 'px';
        textEditor.style.width = (textObj.radius * 2) + 'px';
        textEditor.style.height = (textObj.radius * 2) + 'px';
        textEditor.style.textAlign = 'center';
        textEditor.style.fontSize = '16px';
        textEditor.style.lineHeight = (textObj.radius * 2) + 'px';
    }
    
    textEditor.focus();
    textEditor.select();
}

function hideTextEditor() {
    if (editingText) {
        const trimmedText = textEditor.value.trim();
        if (editingText instanceof TextObject) {
            editingText.text = trimmedText || 'Text';
        } else {
            // For Box and Circle, empty string is fine
            editingText.text = trimmedText;
        }
        editingText = null;
    }
    textEditor.style.display = 'none';
    textEditor.style.textAlign = 'left'; // Reset alignment
    textEditor.style.height = 'auto'; // Reset height
    textEditor.style.lineHeight = 'normal'; // Reset line height
    textEditor.style.fontSize = '20px'; // Reset font size
    draw();
}

textEditor.addEventListener('blur', hideTextEditor);

textEditor.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        hideTextEditor();
    } else if (e.key === 'Escape') {
        e.preventDefault();
        editingText = null;
        textEditor.style.display = 'none';
        draw();
    }
});

// Delete functionality
function deleteShape(shape) {
    // Remove all connections involving this shape
    connections = connections.filter(conn => 
        conn.fromShape !== shape && conn.toShape !== shape
    );
    
    // Remove the shape
    if (shape instanceof Box) {
        boxes = boxes.filter(box => box !== shape);
    } else if (shape instanceof Circle) {
        circles = circles.filter(circle => circle !== shape);
    } else if (shape instanceof TextObject) {
        textObjects = textObjects.filter(t => t !== shape);
    }
    
    // Clear selection if this shape was selected
    if (selectedShapes.has(shape)) {
        selectedShapes.delete(shape);
    }
    if (pendingEdgeSelection && pendingEdgeSelection.shape === shape) {
        pendingEdgeSelection = null;
        tempConnectionEnd = null;
    }
    
    draw();
}

function deleteConnection(connection) {
    // Remove the connection
    connections = connections.filter(conn => conn !== connection);
    
    // Clear selection if this connection was selected
    if (selectedConnection === connection) {
        selectedConnection = null;
        arrowDirectionPanel.style.display = 'none';
    }
    selectedConnections.delete(connection);
    
    draw();
}

// Right-click to delete
canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Check if right-clicking on a connection
    const clickedConnection = connections.find(conn => conn.isPointNear(x, y));
    if (clickedConnection) {
        deleteConnection(clickedConnection);
        return;
    }
    
    // Check if right-clicking on a shape
    let clickedShape = null;
    for (const box of boxes) {
        if (box.contains(x, y)) {
            clickedShape = box;
            break;
        }
    }
    if (!clickedShape) {
        for (const circle of circles) {
            if (circle.contains(x, y)) {
                clickedShape = circle;
                break;
            }
        }
    }
    
    if (clickedShape) {
        deleteShape(clickedShape);
    }
});

// Clear placement mode when Shift is released
window.addEventListener('keyup', (e) => {
    if (e.key === 'Shift') {
        selectedShapeTypeForPlacement = null;
        canvas.style.cursor = '';
    }
});

document.addEventListener('keydown', (e) => {
    if (editingText || textEditor.style.display === 'block') {
        return;
    }
    
    if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        
        // Delete selected connections
        selectedConnections.forEach(conn => {
            deleteConnection(conn);
        });
        selectedConnections.clear();
        
        // Delete single selected connection (for backward compatibility)
        if (selectedConnection && !selectedConnections.has(selectedConnection)) {
            deleteConnection(selectedConnection);
            return;
        }
        
        // Delete selected shapes
        selectedShapes.forEach(shape => {
            deleteShape(shape);
        });
        
        selectedShapes.clear();
        draw();
    }
});

// Double-click to edit text
canvas.addEventListener('dblclick', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Check boxes first
    for (let i = boxes.length - 1; i >= 0; i--) {
        if (boxes[i].contains(x, y)) {
            // Don't edit if clicking on an edge
            if (!boxes[i].getEdgeAt(x, y)) {
                selectedShapes.clear();
                selectedShapes.add(boxes[i]);
                startEditingText(boxes[i]);
                draw();
                return;
            }
        }
    }
    
    // Check circles
    for (let i = circles.length - 1; i >= 0; i--) {
        if (circles[i].contains(x, y)) {
            // Don't edit if clicking on an edge
            if (!circles[i].getEdgeAt(x, y)) {
                selectedShapes.clear();
                selectedShapes.add(circles[i]);
                startEditingText(circles[i]);
    draw();
                return;
            }
        }
    }
    
    // Find text object at click position
    for (let i = textObjects.length - 1; i >= 0; i--) {
        if (textObjects[i].contains(x, y)) {
            selectedShapes.clear();
            selectedShapes.add(textObjects[i]);
            startEditingText(textObjects[i]);
        draw();
            return;
        }
    }
});

// Arrow direction selection (for new connections)
function showArrowDirectionPanel(fromConnection, toShape, toEdge) {
    arrowDirectionPanel.style.display = 'block';
    
    // Remove previous selections
    document.querySelectorAll('.arrow-option').forEach(btn => {
        btn.classList.remove('selected');
        btn.onclick = null;
    });
    
    // Set up click handlers
    document.querySelectorAll('.arrow-option').forEach(btn => {
        btn.onclick = () => {
            const direction = btn.dataset.direction;
            
            // Create connection
            const connection = new Connection(
                fromConnection.shape,
                fromConnection.edge,
                toShape,
                toEdge,
                direction,
                currentColor
            );
            connections.push(connection);
            
            // Reset
            pendingEdgeSelection = null;
            tempConnectionEnd = null;
            waitingForArrowSelection = false;
            arrowDirectionPanel.style.display = 'none';
            draw();
        };
    });
}

// Arrow direction selection (for existing connections)
function showArrowDirectionPanelForConnection(connection) {
    arrowDirectionPanel.style.display = 'block';
    
    // Remove previous selections
    document.querySelectorAll('.arrow-option').forEach(btn => {
        btn.classList.remove('selected');
        btn.onclick = null;
        
        // Highlight current direction
        if (btn.dataset.direction === connection.direction) {
            btn.classList.add('selected');
        }
    });
    
    // Set up click handlers
    document.querySelectorAll('.arrow-option').forEach(btn => {
        btn.onclick = () => {
            const direction = btn.dataset.direction;
            
            // Update connection direction
            connection.direction = direction;
            
            // Reset
            selectedConnection = null;
            arrowDirectionPanel.style.display = 'none';
            draw();
        };
    });
}

// Animation loop for blinking lasso
function animateLasso() {
    if (completedLassoPoints && currentTool === 'lasso') {
        lassoBlinkAnimation += 0.05; // Slower, gentler blinking
        draw();
    }
    requestAnimationFrame(animateLasso);
}

// Initial draw
draw();
// Start animation loop
animateLasso();
