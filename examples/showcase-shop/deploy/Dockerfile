FROM python:3.12-slim
WORKDIR /app
COPY backend/ ./backend/
COPY worker/ ./worker/
CMD ["python", "-m", "backend.main"]
