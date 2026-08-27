import os
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

# SQLite by default — no installation required.
# Override with POSTGRES_URL env var when deploying with PostgreSQL.
_POSTGRES = os.getenv("POSTGRES_URL")

if _POSTGRES:
    SQLALCHEMY_DATABASE_URL = _POSTGRES
    engine = create_engine(_POSTGRES)
else:
    _DB_PATH = os.path.join(os.path.dirname(__file__), "..", "fireguard.db")
    SQLALCHEMY_DATABASE_URL = f"sqlite:///{os.path.abspath(_DB_PATH)}"
    engine = create_engine(
        SQLALCHEMY_DATABASE_URL,
        connect_args={"check_same_thread": False},  # required for SQLite + FastAPI
    )

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
