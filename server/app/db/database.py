import os
from pathlib import Path
from dotenv import load_dotenv
from supabase import create_client, Client

# 1. Load the secret variables from the .env file.
# override=True ensures stale shell vars (e.g., an old anon key) don't win.
_SERVER_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(dotenv_path=_SERVER_ROOT / ".env", override=True)

# 2. Assign them to Python variables
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

# 3. Safety check to ensure the file was read correctly
if not SUPABASE_URL or not SUPABASE_KEY:
    raise ValueError("CRITICAL: Supabase credentials not found. Check your .env file.")

# 4. Initialize and export the active Supabase client
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)