-- Add mime column to audio_cache so WAV and MP3 entries are served correctly.
ALTER TABLE audio_cache ADD COLUMN IF NOT EXISTS mime text NOT NULL DEFAULT 'audio/mpeg';
