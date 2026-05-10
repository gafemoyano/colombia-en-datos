# Colombia en Datos - Frontend

A modern web application for visualizing Colombian demographic, economic, and statistical indicators.

## Tech Stack

- **Framework**: SvelteKit with TypeScript
- **Styling**: Tailwind CSS
- **Charts**: Plotly.js
- **Database**: SQLite with Drizzle ORM
- **Analytics**: DuckDB for querying parquet datasets
- **Testing**: Vitest
- **Code Quality**: ESLint, Prettier

## Prerequisites

- Node.js 22.12 or higher
- npm or pnpm

## Getting Started

1. Install dependencies:

```sh
npm install
```

2. Set up environment variables:

Copy `.env.example` to `.env` and configure:

```sh
cp .env.example .env
```

Edit `.env` with your paths:

```
DATABASE_URL=./drizzle/db.sqlite
DUCKDB_PATH=../data
```

3. Generate and run database migrations:

```sh
npm run db:generate
npm run db:migrate
```

4. Seed the database:

```sh
npm run db:seed
```

5. Start the development server:

```sh
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

## Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Create production build
- `npm run preview` - Preview production build
- `npm run check` - Run TypeScript type checking
- `npm run lint` - Run ESLint
- `npm run format` - Format code with Prettier
- `npm run test` - Run tests with Vitest
- `npm run test:ui` - Run tests with UI
- `npm run db:generate` - Generate database migrations
- `npm run db:migrate` - Run database migrations
- `npm run db:push` - Push schema changes directly
- `npm run db:studio` - Open Drizzle Studio

## Project Structure

```
src/
├── lib/
│   ├── components/       # Svelte components
│   │   ├── PlotlyChart.svelte
│   │   └── IndicatorSelector.svelte
│   ├── db/              # Database configuration
│   │   ├── schema/      # Drizzle ORM schemas
│   │   └── client.ts    # Database client
│   ├── services/        # Business logic services
│   │   └── duckdb.ts    # DuckDB data access
│   └── stores/          # Svelte stores
├── routes/              # SvelteKit routes
│   ├── +layout.svelte
│   └── +page.svelte
└── app.css             # Global styles

drizzle/                # Database migrations & SQLite file
data/                   # Parquet time series files
```

## Features

- Interactive indicator selection
- Real-time data visualization with Plotly
- Responsive design with Tailwind CSS
- Server-side data access with DuckDB
- SQLite for application metadata
- Type-safe database queries with Drizzle ORM

## Deployment

The application is configured for deployment on Fly.io with Docker.

- SQLite database lives on a persistent volume alongside parquet data
- No external database dependencies required
- See `fly.toml` and `Dockerfile` for configuration
