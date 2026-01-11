import { Note, Folder } from './types';

export const INITIAL_FOLDERS: Folder[] = [
  { id: 'f1', name: '00 Start Here', parentId: null, createdAt: Date.now() },
  { id: 'f2', name: 'Projects', parentId: null, createdAt: Date.now() },
  { id: 'f3', name: 'Daily Notes', parentId: null, createdAt: Date.now() },
  { id: 'f4', name: 'Archive', parentId: 'f2', createdAt: Date.now() },
  { id: 'templates', name: 'Templates', parentId: null, createdAt: Date.now() }
];

export const INITIAL_NOTES: Note[] = [
  {
    id: '1',
    folderId: 'f1',
    title: 'Welcome to Rhizonote',
    content: `# Welcome to Rhizonote 🌿\n\nRhizonote is a networked thought tool designed to help you cultivate your digital garden.\n\n## Quick Start\n\n1. **Create a Note**: Click the \`+\` button in the sidebar.\n2. **Link Notes**: Type \`[[\` to link to another note. Try clicking this: [[Rhizonote Features]].\n3. **Daily Notes**: Click the Calendar icon 📅 in the top bar to open today's note.\n\n## Explore\n\n- Check out the [[Markdown Guide]] to see styling options.\n- See how [[Project Orbit]] is organized.\n- Look at an example daily note: [[2024-03-15]].`,
    isBookmarked: true,
    updatedAt: Date.now(),
    createdAt: Date.now(),
    bookmarkOrder: 1
  },
  {
    id: '2',
    folderId: 'f1',
    title: 'Rhizonote Features',
    content: `# Features\n\n## 🔗 Rhizomatic Linking\nLinks are the core of Rhizonote. Just like a rhizome connects roots underground, your notes connect here. When you link to a note (like [[Welcome to Rhizonote]]), a reference is created.\n\nLook at the bottom of this pane. You should see a **"Related Notes"** section showing the "Backlink" from the Welcome page.\n\n## 📅 Daily Notes\nCapture thoughts, tasks, and meetings daily. Default format is \`YYYY-MM-DD\`.\n\n## 🌗 Dark Mode\nToggle between light and dark themes in Settings.\n\n## 🪟 Split View\nClick the split icon in the top right to work on two notes at once.`,
    isBookmarked: false,
    updatedAt: Date.now(),
    createdAt: Date.now(),
  },
  {
    id: '3',
    folderId: 'f1',
    title: 'Markdown Guide',
    content: `# Markdown Syntax\n\n## Text Formatting\n\n**Bold Text**\n*Italic Text*\n~~Strikethrough~~\n\n## Lists\n\n1. First item\n2. Second item\n\n- Bullet point\n- Another point\n\n## Tasks\n\n- [x] Completed task\n- [ ] Pending task (Click me!)\n\n## Code\n\n\`console.log("Hello World");\`\n\n## Blockquote\n\n> Knowledge is power.`,
    isBookmarked: false,
    updatedAt: Date.now(),
    createdAt: Date.now(),
  },
  {
    id: '4',
    folderId: 'f2',
    title: 'Project Orbit',
    content: `# Project Orbit 🚀\n\n**Status**: In Progress\n**Deadline**: Q4 2024\n\n## Objectives\n- [ ] Launch MVP\n- [ ] Gather user feedback\n\n## Meetings\n- Kickoff meeting notes in [[2024-03-15]].\n\n## References\n- [[Design Specs]]\n- [[Marketing Strategy]]`,
    isBookmarked: true,
    updatedAt: Date.now(),
    createdAt: Date.now(),
    bookmarkOrder: 2
  },
  {
    id: '5',
    folderId: 'f3',
    title: '2024-03-15',
    content: `# 2024-03-15\n\n## Morning Reflection\nFeeling energetic. Need to focus on [[Project Orbit]] today.\n\n## Tasks\n- [x] Review [[Design Specs]]\n- [ ] Email the team\n- [ ] Buy groceries\n\n## Meeting Notes: Orbit Kickoff\nAttendees: Alex, Sarah\n\n- Discussed the timeline.\n- Agreed to focus on the mobile view first.\n- **Action Item**: Create mockups by Friday.`,
    isBookmarked: false,
    updatedAt: Date.now(),
    createdAt: Date.now(),
  },
  {
    id: '6',
    folderId: 'f2',
    title: 'Design Specs',
    content: `# Design Specifications\n\nColors:\n- Primary: #4F46E5\n- Background: #F9FAFB\n\nSee [[Project Orbit]] for context.`,
    isBookmarked: false,
    updatedAt: Date.now(),
    createdAt: Date.now(),
  },
  {
    id: 'tpl1',
    folderId: 'templates',
    title: 'Meeting Template',
    content: `# Meeting: {{title}}\n**Date**: {{date}} {{time}}\n\n## Attendees\n\n## Agenda\n1. \n\n## Notes\n- \n\n## Action Items\n- [ ] `,
    isBookmarked: false,
    updatedAt: Date.now(),
    createdAt: Date.now(),
  },
  {
    id: 'tpl2',
    folderId: 'templates',
    title: 'Project Template',
    content: `# Project: {{title}}\n**Start Date**: {{date}}\n\n## Goals\n- \n\n## Milestones\n- [ ] Phase 1\n- [ ] Phase 2`,
    isBookmarked: false,
    updatedAt: Date.now(),
    createdAt: Date.now(),
  }
];