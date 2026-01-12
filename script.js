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
let isPanning = false;
let panStart = { x: 0, y: 0 };
let panOffset = { x: 0, y: 0 };
let canvasOffset = { x: 0, y: 0 };
let editingText = null;
let currentColor = '#667eea';

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
    }

    draw(isSelected = false) {
        ctx.fillStyle = this.color;
        ctx.fillRect(this.x + canvasOffset.x, this.y + canvasOffset.y, this.width, this.height);
        
        ctx.strokeStyle = isSelected ? '#48bb78' : '#333';
        ctx.lineWidth = isSelected ? 3 : 2;
        ctx.strokeRect(this.x + canvasOffset.x, this.y + canvasOffset.y, this.width, this.height);
        
        // Draw text if it exists
        if (this.text) {
        ctx.fillStyle = 'white';
        ctx.font = '16px sans-serif';
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

    // Detect which edge was clicked (with some tolerance)
    getEdgeAt(x, y, tolerance = 10) {
        const worldX = x - canvasOffset.x;
        const worldY = y - canvasOffset.y;
        const centerX = this.x + this.width / 2;
        const centerY = this.y + this.height / 2;
        const dx = worldX - centerX;
        const dy = worldY - centerY;
        
        // Check if click is near an edge
        if (Math.abs(worldX - this.x) < tolerance && Math.abs(dy) < this.height / 2) {
            return 'left';
        }
        if (Math.abs(worldX - (this.x + this.width)) < tolerance && Math.abs(dy) < this.height / 2) {
            return 'right';
        }
        if (Math.abs(worldY - this.y) < tolerance && Math.abs(dx) < this.width / 2) {
            return 'top';
        }
        if (Math.abs(worldY - (this.y + this.height)) < tolerance && Math.abs(dx) < this.width / 2) {
            return 'bottom';
        }
        
        return null;
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
        if (dx <= 0 && dy <= 0) {
            // Top-left quadrant -> top edge
            return 'top';
        } else if (dx > 0 && dy <= 0) {
            // Top-right quadrant -> right edge
            return 'right';
        } else if (dx <= 0 && dy > 0) {
            // Bottom-left quadrant -> left edge
            return 'left';
        } else {
            // Bottom-right quadrant -> bottom edge
            return 'bottom';
        }
    }
}

// Circle class
class Circle extends DrawableObject {
    constructor(x, y) {
        super(x, y);
        this.radius = 40;
        this.color = currentColor;
        this.text = '';
    }

    draw(isSelected = false) {
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x + canvasOffset.x + this.radius, this.y + canvasOffset.y + this.radius, this.radius, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.strokeStyle = isSelected ? '#48bb78' : '#333';
        ctx.lineWidth = isSelected ? 3 : 2;
        ctx.stroke();
        
        // Draw text if it exists
        if (this.text) {
        ctx.fillStyle = 'white';
        ctx.font = '16px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        // Handle text overflow - truncate if too long
        const maxWidth = this.radius * 1.8;
        let displayText = this.text;
        const metrics = ctx.measureText(displayText);
        if (metrics.width > maxWidth) {
            // Truncate text with ellipsis
            while (ctx.measureText(displayText + '...').width > maxWidth && displayText.length > 0) {
                displayText = displayText.slice(0, -1);
            }
            displayText = displayText + '...';
        }
        
            ctx.fillText(displayText, this.x + canvasOffset.x + this.radius, this.y + canvasOffset.y + this.radius);
        }
    }

    contains(x, y) {
        const worldX = x - canvasOffset.x;
        const worldY = y - canvasOffset.y;
        const centerX = this.x + this.radius;
        const centerY = this.y + this.radius;
        const dx = worldX - centerX;
        const dy = worldY - centerY;
        return Math.sqrt(dx * dx + dy * dy) <= this.radius;
    }
    
    getBounds() {
        return { x: this.x, y: this.y, width: this.radius * 2, height: this.radius * 2 };
    }

    // Get the edge point based on edge name ('top', 'bottom', 'left', 'right')
    getEdgePoint(edge) {
        const centerX = this.x + this.radius;
        const centerY = this.y + this.radius;
        switch(edge) {
            case 'top':
                return { x: centerX, y: this.y };
            case 'bottom':
                return { x: centerX, y: this.y + this.radius * 2 };
            case 'left':
                return { x: this.x, y: centerY };
            case 'right':
                return { x: this.x + this.radius * 2, y: centerY };
            default:
                return { x: centerX, y: centerY };
        }
    }

    // Detect which edge was clicked (with some tolerance)
    getEdgeAt(x, y, tolerance = 10) {
        const worldX = x - canvasOffset.x;
        const worldY = y - canvasOffset.y;
        const centerX = this.x + this.radius;
        const centerY = this.y + this.radius;
        const dx = worldX - centerX;
        const dy = worldY - centerY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        // Check if click is near the edge of the circle
        if (Math.abs(distance - this.radius) < tolerance) {
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
        const centerX = this.x + this.radius;
        const centerY = this.y + this.radius;
        const dx = worldX - centerX;
        const dy = worldY - centerY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        // Check if point is within the circle bounds (with some padding)
        const padding = 20;
        if (distance > this.radius + padding) {
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
        this.textColor = '#000000';
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
    });
    
    // Draw all text objects
    textObjects.forEach(textObj => {
        textObj.draw(selectedShapes.has(textObj));
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
draggableBox.addEventListener('dragstart', (e) => {
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('shapeType', 'box');
    draggableBox.classList.add('dragging');
});

draggableBox.addEventListener('dragend', () => {
    draggableBox.classList.remove('dragging');
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

canvasContainer.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    canvasContainer.classList.add('drag-over');
});

canvasContainer.addEventListener('dragleave', () => {
    canvasContainer.classList.remove('drag-over');
});

canvasContainer.addEventListener('drop', (e) => {
    e.preventDefault();
    canvasContainer.classList.remove('drag-over');
    
    const shapeType = e.dataTransfer.getData('shapeType');
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left - canvasOffset.x - 40;
    const y = e.clientY - rect.top - canvasOffset.y - 40;
    
    if (shapeType === 'circle') {
        const snappedX = snapToGrid(x);
        const snappedY = snapToGrid(y);
        circles.push(new Circle(snappedX, snappedY));
    } else if (shapeType === 'box') {
        const snappedX = snapToGrid(x);
        const snappedY = snapToGrid(y);
        boxes.push(new Box(snappedX, snappedY));
    } else if (shapeType === 'text') {
        const snappedX = snapToGrid(x);
        const snappedY = snapToGrid(y);
        const textObj = new TextObject(snappedX, snappedY);
        textObjects.push(textObj);
        selectedShapes.clear();
        selectedShapes.add(textObj);
        // Automatically start editing the text after placement
        startEditingText(textObj);
    }
    draw();
});

// Canvas mouse events
canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
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
                // Single select
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
                dragOffset.x -= clickedObject.radius;
                dragOffset.y -= clickedObject.radius;
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
    
    if (isDragging && (selectedShapes.size > 0 || selectedConnections.size > 0)) {
        // Calculate movement delta from initial click position (in screen coordinates)
        // Since shapes use world coordinates, we need to account for canvas offset
        const deltaX = x - dragStartPos.x;
        const deltaY = y - dragStartPos.y;
        
        // Move all selected shapes based on their initial positions
        dragStartShapes.forEach(({ shape, x: startX, y: startY }) => {
            if (selectedShapes.has(shape)) {
                // Calculate new position
                let newX = startX + deltaX;
                let newY = startY + deltaY;
                
                // Snap to grid
                newX = snapToGrid(newX);
                newY = snapToGrid(newY);
                
                shape.x = newX;
                shape.y = newY;
                
                // Keep within reasonable bounds (optional)
                if (shape instanceof Circle) {
                    shape.x = Math.max(-shape.radius * 2, shape.x);
                    shape.y = Math.max(-shape.radius * 2, shape.y);
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
    dragStartLassoPoints = null; // Reset lasso points reference
    canvas.style.cursor = currentTool === 'lasso' ? 'crosshair' : 'default';
});

canvas.addEventListener('mouseleave', () => {
    isDragging = false;
    isPanning = false;
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
