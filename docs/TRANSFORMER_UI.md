# UI Changes for Transformer Architecture

## New Form Section in RL Agents Panel

When creating a new agent, users will see a new section for enabling the Transformer architecture:

```
┌─────────────────────────────────────────────────────────────────────┐
│  Create New Agent                                                    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  Agent Name: [my_transformer_agent            ]                     │
│  Description: [Trading with advanced AI       ]                     │
│                                                                       │
│  Holding Period: [Swing Short (1-3 days)  ▼]                       │
│  Risk Profile:   [Moderate               ▼]                         │
│  Trading Style:  [Mixed                  ▼]                         │
│  ...                                                                 │
│  (standard configuration fields)                                     │
│  ...                                                                 │
│                                                                       │
├─────────────────────────────────────────────────────────────────────┤
│  ╔═══════════════════════════════════════════════════════════════╗ │
│  ║  TRANSFORMER ARCHITECTURE SECTION                             ║ │
│  ╚═══════════════════════════════════════════════════════════════╝ │
│                                                                       │
│  ☑ 🚀 Use Advanced Transformer Architecture       [▶ Show Options] │
│                                                                       │
│  ✨ ~2.5-3M parameters (vs ~300k for standard MLP)                  │
│  Enables temporal awareness via self-attention, multi-scale          │
│  feature extraction, and market regime detection for superior        │
│  pattern recognition.                                                │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  ADVANCED OPTIONS (when expanded)                           │   │
│  ├─────────────────────────────────────────────────────────────┤   │
│  │  d_model:   [256  ]  (model dimension, 64-512)              │   │
│  │  n_heads:   [8    ]  (attention heads, 1-16)                │   │
│  │  n_layers:  [4    ]  (transformer blocks, 1-8)              │   │
│  │  d_ff:      [512  ]  (feedforward dimension, 128-2048)      │   │
│  │  dropout:   [0.10 ]  (dropout rate, 0-0.5)                  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                       │
├─────────────────────────────────────────────────────────────────────┤
│                                        [Cancel]  [Start Training]    │
└─────────────────────────────────────────────────────────────────────┘
```

## Visual Features

### 1. Transformer Section Design
- **Dark background** (slate-800) with subtle border
- **Checkbox with emoji** for visual appeal (🚀)
- **Collapsible options** to avoid overwhelming users
- **Info text** explaining benefits in simple terms

### 2. When Checkbox is Checked
- **Default values** automatically populated
- **Advanced options** can be expanded/collapsed
- **Parameter limits** enforced via input constraints

### 3. Visual Hierarchy
```
Regular Config Fields
    ↓
━━━━━━━━━━━━━━━━━━━
Transformer Section (highlighted)
    ↓ (if enabled)
Advanced Options (collapsible)
━━━━━━━━━━━━━━━━━━━
    ↓
Action Buttons
```

## Training Console Output

When training with Transformer architecture, users see detailed logging:

```
🧠 Creating PPO model with Transformer architecture...
   d_model: 256
   n_heads: 8
   n_layers: 4
   d_ff: 512
   dropout: 0.1
   Learning rate: 0.0003
   Gamma: 0.99
   📊 Parameter count: 2,847,239 total
      - CNN Encoder: 523,264
      - Transformer: 1,835,008
      - Regime Detector: 41,476
      - Aggregation: 196,608
      - Actor: 136,455
      - Critic: 114,428
🚀 Training started for agent 'transformer_trader'
   Total timesteps: 100,000
   Device: cuda
⏳ Progress: 10.0% (10,000/100,000 steps) | Mean reward: 125.34
...
✅ Training completed!
```

## UI States

### Before Enabling Transformer
```
┌─────────────────────────────────────────┐
│ ☐ 🚀 Use Advanced Transformer           │
│    Architecture          [▶ Show Options]│
│                                          │
│ (info text shown but grayed out)        │
└─────────────────────────────────────────┘
```

### After Enabling Transformer (Options Collapsed)
```
┌─────────────────────────────────────────┐
│ ☑ 🚀 Use Advanced Transformer           │
│    Architecture          [▶ Show Options]│
│                                          │
│ ✨ ~2.5-3M parameters (vs ~300k)        │
│ (full info text in white/bright color)  │
└─────────────────────────────────────────┘
```

### After Enabling Transformer (Options Expanded)
```
┌─────────────────────────────────────────┐
│ ☑ 🚀 Use Advanced Transformer           │
│    Architecture          [▼ Hide Options]│
│                                          │
│ ✨ ~2.5-3M parameters (vs ~300k)        │
│                                          │
│ ┌─────────────────────────────────────┐ │
│ │ d_model:  [256  ]                   │ │
│ │ n_heads:  [8    ]                   │ │
│ │ n_layers: [4    ]                   │ │
│ │ d_ff:     [512  ]                   │ │
│ │ dropout:  [0.10 ]                   │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

## Color Scheme

All styling follows the existing DayTrader theme:
- **Background**: `bg-slate-800` (dark section background)
- **Border**: `border-slate-600` (subtle outline)
- **Text Primary**: `text-white` (main text)
- **Text Secondary**: `text-slate-400` (labels, help text)
- **Accent**: `text-blue-400` (links, highlights)
- **Input Fields**: `bg-slate-600` (form inputs)

## Responsive Design

The layout adapts to different screen sizes:
- **Desktop**: 2-3 columns for advanced options
- **Tablet**: 2 columns
- **Mobile**: Single column (stacked)

Grid classes used: `grid-cols-2 md:grid-cols-3`
