# Colombia en Datos - Frontend

A modern web application for visualizing Colombian demographic, economic, and statistical indicators.

## Tech Stack

- **Framework**: SvelteKit with TypeScript
- **Styling**: Tailwind CSS
- **Charts**: Plotly.js
- **Database**: PostgreSQL with Drizzle ORM
- **Analytics**: DuckDB for querying parquet datasets
- **Testing**: Vitest
- **Code Quality**: ESLint, Prettier

## Prerequisites

- Node.js 22.12 or higher
- PostgreSQL database
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

Edit `.env` with your database credentials:

```
DATABASE_URL=postgresql://user:password@localhost:5432/colombia_en_datos
DUCKDB_PATH=../data
```

3. Generate and run database migrations:

```sh
npm run db:generate
npm run db:migrate
```

4. Start the development server:

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

drizzle/                # Database migrations
```

## Features

- Interactive indicator selection
- Real-time data visualization with Plotly
- Responsive design with Tailwind CSS
- Server-side data access with DuckDB
- PostgreSQL for application metadata
- Type-safe database queries with Drizzle ORM

## Deployment

To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.

For Docker deployment, ensure PostgreSQL and data volumes are properly configured.
