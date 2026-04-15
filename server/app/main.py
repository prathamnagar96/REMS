import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api.routes import registration
from .api.routes import workflow

app = FastAPI(title="Rental Management API", version="0.1.0")

cors_origins = [origin.strip() for origin in os.getenv("CORS_ALLOW_ORIGINS", "http://localhost:5173").split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(registration.router)
app.include_router(workflow.router)


@app.get("/health", tags=["health"])
async def health_check():
    return {"status": "ok"}
