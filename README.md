# Physical Rehabilitation System for Stroke Patients Using Artificial Intelligence

## 1. Project Overview

A web-based rehabilitation platform designed to support physical therapists in managing rehabilitation programs and monitoring upper-limb exercises performed by stroke patients remotely.

The system uses AI-based pose estimation and hand tracking to analyze exercise movements and provide automated performance scores.

## 2. Technology Stack

| Component | Technology |
|---|---|
| Frontend | React, TypeScript, Vite |
| Backend | Node.js, Express.js, TypeScript |
| Database | PostgreSQL |
| ORM | Prisma |
| Authentication | JWT, bcrypt |
| AI Movement Tracking | MediaPipe |
| Containerization | Docker, Docker Compose |

## 3. System Requirements

Before running the project, install:

- Git
- Node.js 20 or later
- npm
- Docker Desktop
- Docker Compose

## 4. Installation

### 4.1 Clone the Repository

```bash
git clone https://github.com/SilveRoach/y4-project-stroke-rehabiliation-ai.git
cd <project-folder>
```

### 4.2 Environment Configuration

Configure the environment variables using the provided example files.

```bash
cp .env.example .env
```

Configure the required database connection, authentication, and media storage settings.

Also configure the frontend environment variables according to the provided example file.

### 4.3 Install Dependencies

Install backend and frontend dependencies:

```bash
cd app/backend
npm install

cd app/frontend
npm install
```

## 5. Database Setup

Start the PostgreSQL database using Docker Compose.

```bash
docker compose up -d db
```

Generate Prisma Client and apply database migrations:

```bash
cd app/backend
npm run prisma:migrate
npm run prisma:seed
```

## 6. Running the Application

### Option A: Docker Compose

From the project root:

```bash
docker compose up --build
```

To stop the application:

```bash
docker compose down
```

### Option B: Local Development

Run the backend and frontend in separate terminals.

**Backend:**

```bash
cd app/backend
npm run dev
```

**Frontend:**

```bash
cd app/frontend
npm run dev
```

## 7. Accessing the Application

Once the services are running, access the frontend using the development URL configured by Vite.

The backend API is available through the configured backend port, with API routes under `/api/v1`.