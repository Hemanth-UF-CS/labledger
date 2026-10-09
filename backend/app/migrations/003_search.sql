ALTER TABLE model_versions ADD COLUMN search tsvector
    GENERATED ALWAYS AS (
        setweight(to_tsvector('english', name), 'A') ||
        setweight(to_tsvector('english', architecture), 'B') ||
        setweight(to_tsvector('english', coalesce(notes, '')), 'C')
    ) STORED;
CREATE INDEX model_versions_search_idx ON model_versions USING gin (search);

ALTER TABLE datasets ADD COLUMN search tsvector
    GENERATED ALWAYS AS (
        setweight(to_tsvector('english', name), 'A') ||
        setweight(to_tsvector('english', description), 'B')
    ) STORED;
CREATE INDEX datasets_search_idx ON datasets USING gin (search);

ALTER TABLE projects ADD COLUMN search tsvector
    GENERATED ALWAYS AS (
        setweight(to_tsvector('english', name), 'A') ||
        setweight(to_tsvector('english', description), 'B') ||
        setweight(to_tsvector('english', task), 'B')
    ) STORED;
CREATE INDEX projects_search_idx ON projects USING gin (search);
