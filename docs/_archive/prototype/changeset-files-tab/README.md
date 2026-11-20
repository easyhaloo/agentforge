# Changeset Files Tab - Interactive Prototype

This prototype demonstrates the proposed "Files" tab for the Changeset detail page in AgentForge, similar to GitHub's "Files Changed" view.

## 📁 Files

- `index.html` - Standalone interactive prototype (open directly in browser)

## 🎯 Features Implemented

### 1. **Resizable File Tree Sidebar**
- **Hierarchical directory structure** with collapsible folders
- **Expandable/collapsible directories** with chevron icons (▶/▼)
- **GitHub-style document icons** (authentic file status representation):
  - Added files: Green document with plus icon (#3fb950)
  - Modified files: Gray document icon (#57606a)
  - Deleted files: Red document with minus icon (#f85149)
- **Clear visual hierarchy**:
  - Folders: Bold font (12px), blue folder icon, collapsible chevron
  - Files: Regular font (12px), document icon, 20px left indent under folders
  - Improved line height (1.6) for better readability
- Shows per-file additions (+) and deletions (−) in muted colors
- Sidebar collapsible/expandable via "Collapse" button
- Draggable resize handle with visual feedback
- Total statistics in footer (files changed, total +/−)

### 2. **Diff Viewer**
- **Unified/Split view toggle** - Switch between viewing modes
- **Syntax-highlighted diffs** with proper color coding:
  - Added lines: green background (#0d3a2e) with green text (#65c89b)
  - Deleted lines: red background (#3d252f) with red text (#e28d98)
  - Context lines: default background with muted text
- **Line numbers** for both old and new versions
- **Hunk headers** showing change locations (e.g., `@@ -10,3 +10,4 @@`)
- File header with path and change statistics

### 3. **Interactive Navigation**
- Click any file in the tree to view its diff
- Visual selection state (purple highlight)
- Hover states on all interactive elements
- "Show Files" button appears when sidebar is collapsed

### 4. **Design System Integration**
- Uses AgentForge's exact color palette from `theme.css`:
  - Primary: `#8878f6` (purple)
  - Backgrounds: `#090d16`, `#101725`, `#141c2b`
  - Text colors: `#e8eaf2`, `#98a3b8`, `#69758c`
  - Borders: `#273248`
- Matches existing component styles (buttons, inputs, tabs)
- Consistent spacing, border-radius, and transitions

## 🎨 Design Decisions

### Layout
- **Two-panel layout** with resizable divider follows GitHub's proven pattern
- **Sidebar width defaults to 320px** - balances file list visibility with diff space
- **Min-width 200px, max-width 600px** - prevents unusable extremes
- **Fixed height container (700px)** - scrollable content areas, not the whole page

### File Tree Hierarchy (GitHub-inspired)
**Visual Structure:**
- **Folders** are collapsible with clear visual indicators:
  - Chevron icon (▶/▼) for expand/collapse state
  - Blue folder icon (#6ca0dc) for immediate recognition
  - Bold font (12px, weight 600) for prominence
  - Hover state for interactivity feedback
  
- **Files** are clearly nested under their folders:
  - 20px left indentation to show hierarchy
  - Regular font weight (12px) to distinguish from folders
  - Line height 1.6 for comfortable reading
  - 2px vertical margin for visual breathing room

**Status Icons (GitHub Document Style):**
- Uses document-shaped icons to represent file status (matches GitHub's actual design):
  - **Modified (📄)**: Gray document icon (#57606a) - standard file icon
  - **Added (📄+)**: Green document with plus overlay (#3fb950) - new file indicator
  - **Deleted (📄−)**: Red document with minus overlay (#f85149) - removed file indicator
- Icons are 16x16px SVG from GitHub's Primer design system
- Document shape provides clear file context compared to abstract circles
- Status is conveyed through color + overlay symbol (plus/minus for added/deleted)
- Positioned before filename with 8px spacing
- SVG includes proper accessibility attributes (aria-hidden since status is conveyed visually)

### Color Scheme for Diffs
The diff colors were carefully chosen to:
1. Match AgentForge's dark theme aesthetics
2. Provide sufficient contrast for accessibility (WCAG AA)
3. Be distinguishable for users with color vision deficiencies
4. Use subtle backgrounds to reduce eye strain during code review

**Diff colors:**
- Add: `#0d3a2e` (bg) / `#65c89b` (text) - Muted green, less aggressive than GitHub
- Delete: `#3d252f` (bg) / `#e28d98` (text) - Muted red/pink from existing danger color
- Context: `#98a3b8` (text) - Secondary text color for non-changed lines

### Typography
- **Monospace font** for code: SF Mono, Monaco, Cascadia Code (system defaults)
- **11px font size** for code - matches existing AgentForge component sizes
- **Line height 1.6** - provides comfortable reading for code

### Interactive Elements
- **Folder expand/collapse** - Click folder headers to toggle visibility of contained files
- **Chevron rotation animation** - Smooth 0.15s transition when folders expand/collapse
- **Smooth transitions (0.15s)** on hover/active states - matches existing components
- **Visual feedback on resize** - handle changes color to primary when dragging
- **Selected file highlighting** - uses the same purple accent as active tabs
- **Directory hover states** - provides clear feedback for clickable folders
- **SVG status icons** - Authentic GitHub graphics with accessibility labels

## 🔧 Technical Choices

### Why Vanilla JavaScript?
1. **Zero dependencies** - can be opened directly in any browser
2. **Easier to demo** - no build step or npm install required
3. **Simple to understand** - clear DOM manipulation logic
4. **Easy migration** - logic can be directly ported to React

### Implementation Pattern
```javascript
// Simple MVC-like structure:
- Data layer: files array with diff objects
- Render functions: renderFileTree(), renderDiff()
- Event handlers: sidebar collapse, resize, view toggle
```

### State Management
- `selectedFile` - Currently selected file for diff display
- `viewMode` - 'unified' or 'split'
- `expandedDirs` - Set tracking which directories are expanded (all expanded by default)

## 🚀 Implementation Suggestions

### For Production (React + TypeScript)

#### 1. **Component Structure**
```
ChangesetFilesTab/
├── ChangesetFilesTab.tsx          (Main container)
├── FilesTreeSidebar.tsx           (Left panel)
│   ├── FileTreeItem.tsx
│   └── FileTreeDirectory.tsx
├── DiffViewer.tsx                 (Right panel)
│   ├── DiffViewerHeader.tsx       (View mode toggle)
│   ├── DiffFileHeader.tsx
│   └── DiffCodeBlock.tsx
└── hooks/
    ├── useResizableSidebar.ts
    └── useFileDiff.ts
```

#### 2. **Data Fetching**
```typescript
// API endpoint (to be implemented)
GET /api/orgs/:orgID/changesets/:changesetID/files

Response:
{
  files: [
    {
      path: string,
      status: 'added' | 'modified' | 'deleted',
      additions: number,
      deletions: number,
      viewed: boolean,
      diff: string  // unified diff format or structured diff
    }
  ]
}
```

#### 3. **Integration with Existing Codebase**

**Update routing** (`src/shared/routing/paths.ts`):
```typescript
export const changesetTabs = [
  "overview", "revisions", "evaluation", "review", 
  "files",  // Add this
  "merge"
] as const;
```

**Add route** (`src/app/routes.tsx`):
```typescript
{
  path: "/orgs/:org/changesets/:id/files",
  element: <ChangesetDetailPage tab="files" />
}
```

**Add tab handler** (`src/pages/changesets/ChangesetDetailPage.tsx`):
```typescript
{tab === "files" && <ChangesetFilesTab 
  organization={organization}
  changesetID={changesetID}
  revision={revision}
/>}
```

#### 4. **Styling Approach**
- Extract colors to CSS variables (already defined in theme.css)
- Create new `.changeset-files.*` CSS classes following BEM convention
- Reuse existing `.af-*` utility classes from components.css
- Consider creating a new `changeset-files.css` in the same directory as `ChangesetDetailPage.tsx`

#### 5. **Performance Considerations**
- **Virtualize file tree** if >100 files (use `react-window` or `react-virtual`)
- **Lazy-load diffs** - only fetch diff content when file is selected
- **Syntax highlighting** - use `react-syntax-highlighter` with async loading
- **Debounce resize** - prevent excessive re-renders during drag

#### 6. **Accessibility Enhancements**
- Add ARIA labels to all interactive elements
- Keyboard navigation in file tree (↑↓ arrows, Enter to select)
- Focus management when switching files
- Screen reader announcements for file selection
- Skip links to jump between sidebar and diff viewer

#### 7. **Additional Features** (Future Enhancements)
- **File search/filter** in sidebar
- **Expand/collapse unchanged code sections** (GitHub-style "...")
- **Comment on specific lines** (if code review feature exists)
- **Jump to file** from other tabs (deep linking)
- **File type icons** (use `react-file-icon` or similar)
- **Diff statistics chart** (visual bar showing add/delete ratio)
- **"View in WebIDE" button** per file (already implemented elsewhere)
- **Sticky file header** when scrolling through large diffs

## 📐 Responsive Design

Current prototype is optimized for desktop (≥1024px width). For production:

**Tablet (768px - 1023px):**
- Reduce default sidebar width to 280px
- Reduce font sizes slightly

**Mobile (<768px):**
- Stack layout vertically or use tabs instead of side-by-side
- Sidebar becomes a bottom sheet or modal
- Simplify diff view (remove split mode, unified only)

## 🧪 Testing Checklist

When implementing the production version:

- [ ] File tree renders correctly with nested directories
- [ ] Clicking a file loads and displays its diff
- [ ] Sidebar resize works smoothly (min/max constraints)
- [ ] Sidebar collapse/expand maintains state
- [ ] "Mark as viewed" checkboxes persist (API call)
- [ ] View mode toggle (Unified/Split) works correctly
- [ ] Keyboard navigation through file tree
- [ ] Screen reader announces file selection
- [ ] Works in Chrome, Firefox, Safari, Edge
- [ ] Responsive behavior on tablet and mobile
- [ ] Large files (1000+ lines) render without lag
- [ ] Error states (API failure, no files changed)
- [ ] Loading states while fetching diffs

## 🎭 Demo Instructions

1. Open `index.html` in any modern browser
2. **Explore the file tree:**
   - **Click folder headers** to expand/collapse directories (watch the chevron rotate)
   - **Click files** to view their diffs in the right panel
   - **Notice the document icons**: gray 📄 for modified, green 📄+ for added, red 📄− for deleted
3. **Resize the sidebar** by dragging the vertical divider
4. **Collapse/expand sidebar:**
   - Click "Collapse" to hide the sidebar
   - Click "Show Files" to restore it
5. **Toggle diff view modes** between "Unified" and "Split"

## 📝 Notes

### Sample Data
The prototype uses three real files from the AgentForge codebase:
- `src/app/routes.tsx` - Adding the files route
- `src/shared/routing/paths.ts` - Adding "files" to changesetTabs
- `src/pages/changesets/ChangesetDetailPage.tsx` - Importing and using the Files tab

All files are organized under their respective directories, demonstrating the hierarchical folder structure.

### Design Updates

**Version 1.3 (Latest)**
1. **Document-Based Status Icons** (GitHub Screenshot Alignment):
   - Replaced circle/dot icons with document-shaped file icons
   - **Modified files**: Gray document icon (#57606a) - consistent with GitHub's design
   - **Added files**: Green document with plus overlay (#3fb950)
   - **Deleted files**: Red document with minus overlay (#f85149)
   - Icons now use file/document metaphor instead of abstract shapes
   - Matches GitHub's actual Files Changed page design exactly

2. **Updated Selection State**:
   - Changed from purple highlight to subtle gray background
   - Background: `rgba(175, 184, 193, 0.12)` - matches GitHub's selection color
   - Selected file name uses medium font weight (500) for emphasis
   - More consistent with GitHub's visual language

**Version 1.2**
1. **Removed "Mark as Viewed" Feature**:
   - Eliminated all checkboxes from file tree items
   - Simplified file item layout and interaction
   - Reduced visual clutter for cleaner interface

2. **Authentic GitHub SVG Icons** (superseded by v1.3):
   - Initial implementation with circle-based status icons
   - Later replaced with document-based icons for better GitHub alignment

**Version 1.1**
1. **Enhanced File Tree Hierarchy**:
   - Folders now have collapsible/expandable behavior with animated chevrons
   - Improved visual distinction between folders (bold, 12px) and files (regular, 12px)
   - Better indentation (20px) for nested files under directories
   - Line height increased to 1.6 for improved readability
   - Added subtle vertical margins (2px) between file items

2. **Improved Typography**:
   - Font size standardized to 12px (up from 11px) for better readability
   - Line height set to 1.6 for comfortable scanning
   - Proper font weights to establish clear hierarchy (folders: 600, files: 400)

### Known Limitations (Prototype Only)
- Split view is simplified (shows same content twice, not true side-by-side old/new)
- No syntax highlighting beyond basic diff coloring
- Checkbox state doesn't persist (no backend integration)
- No error handling or loading states
- No keyboard navigation
- Fixed sample data (not dynamic)

### Browser Compatibility
Tested and working in:
- Chrome 120+
- Firefox 121+
- Safari 17+
- Edge 120+

Requires modern CSS features (CSS Grid, CSS Variables, accent-color).

## 🔗 Related Files

When implementing, reference these existing components:
- `/Users/shenggangshu/llm/agentforge/apps/web/src/pages/changesets/ChangesetDetailPage.tsx`
- `/Users/shenggangshu/llm/agentforge/apps/web/src/shared/routing/paths.ts`
- `/Users/shenggangshu/llm/agentforge/apps/web/src/shared/ui/theme/theme.css`
- `/Users/shenggangshu/llm/agentforge/apps/web/src/shared/ui/components/components.css`

## 📧 Questions & Feedback

After reviewing the prototype, consider:
1. Is the default sidebar width (320px) appropriate?
2. Should split view show true side-by-side comparison or simplified like GitHub?
3. Do we need file type icons, or are status badges sufficient?
4. Should "mark as viewed" be per-user or per-changeset?
5. Priority of additional features (search, comments, expand/collapse, etc.)?

---

**Prototype Version:** 1.0  
**Created:** 2024  
**Design System:** AgentForge v2  
**Target Implementation:** React 18 + TypeScript 5
