BEGIN;

CREATE TABLE IF NOT EXISTS public.contacts (
  id uuid PRIMARY KEY,

  name text NOT NULL
    CHECK (
      char_length(name)
      BETWEEN 2 AND 80
    ),

  email text NOT NULL
    CHECK (
      char_length(email)
      BETWEEN 3 AND 254
    ),

  message text NOT NULL
    CHECK (
      char_length(message)
      BETWEEN 10 AND 2000
    ),

  status text NOT NULL DEFAULT 'new'
    CHECK (
      status IN (
        'new',
        'read',
        'archived'
      )
    ),

  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS public.admins (
  id uuid PRIMARY KEY,

  name text NOT NULL
    CHECK (
      char_length(name)
      BETWEEN 2 AND 80
    ),

  email text NOT NULL UNIQUE
    CHECK (
      char_length(email)
      BETWEEN 3 AND 254
    )
    CHECK (
      email = lower(email)
    ),

  password_hash text NOT NULL,

  role text NOT NULL DEFAULT 'admin'
    CHECK (
      role = 'admin'
    ),

  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS
  idx_contacts_created_at
ON public.contacts(created_at DESC);

CREATE INDEX IF NOT EXISTS
  idx_contacts_status
ON public.contacts(status);

ALTER TABLE public.contacts
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.admins
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL
ON TABLE public.contacts
FROM anon, authenticated;

REVOKE ALL
ON TABLE public.admins
FROM anon, authenticated;

COMMIT;