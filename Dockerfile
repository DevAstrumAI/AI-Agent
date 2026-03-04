# ── Stage: Python base ────────────────────────────────────────
FROM python:3.11-slim

# Set working directory
WORKDIR /app

ENV PYTHONPATH=/app        

# Install system dependencies needed by some Python packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    gcc \
    g++ \
    libffi-dev \
    libssl-dev \
    curl \
    sqlite3 \
    && rm -rf /var/lib/apt/lists/*

# ── Install Python dependencies ───────────────────────────────
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip
RUN pip install --no-cache-dir -r requirements.txt

RUN playwright install chromium --with-deps

# ── Copy application code ─────────────────────────────────────
COPY . .

# Create required directories if they don't exist
RUN mkdir -p data/clean_text data/raw_html data/faiss_index database pdf_data/files

# ── Copy and set entrypoint script ───────────────────────────
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

# ── Expose port ───────────────────────────────────────────────
EXPOSE 8080

# ── Start both services via shell script ──────────────────────
CMD ["/app/start.sh"]