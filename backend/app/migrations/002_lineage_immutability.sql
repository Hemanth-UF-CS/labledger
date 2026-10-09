-- Provenance fields are frozen once a version is registered. Stage and notes may change;
-- anything that determines what the model *is* may not. Change it -> register a new version.

CREATE FUNCTION forbid_provenance_update() RETURNS trigger AS $$
BEGIN
    IF NEW.hyperparams        IS DISTINCT FROM OLD.hyperparams
    OR NEW.dataset_version_id IS DISTINCT FROM OLD.dataset_version_id
    OR NEW.code_commit        IS DISTINCT FROM OLD.code_commit
    OR NEW.architecture       IS DISTINCT FROM OLD.architecture
    OR NEW.version            IS DISTINCT FROM OLD.version THEN
        RAISE EXCEPTION 'model_versions.% is immutable; register a new version instead', OLD.id
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER model_versions_provenance_guard
    BEFORE UPDATE ON model_versions
    FOR EACH ROW EXECUTE FUNCTION forbid_provenance_update();

CREATE FUNCTION forbid_dataset_version_update() RETURNS trigger AS $$
BEGIN
    IF NEW.checksum IS DISTINCT FROM OLD.checksum
    OR NEW.uri      IS DISTINCT FROM OLD.uri
    OR NEW.splits   IS DISTINCT FROM OLD.splits THEN
        RAISE EXCEPTION 'dataset_versions.% is immutable', OLD.id
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER dataset_versions_guard
    BEFORE UPDATE ON dataset_versions
    FOR EACH ROW EXECUTE FUNCTION forbid_dataset_version_update();

-- Full lineage of a model version, walking parent links back to the first version.
CREATE FUNCTION model_lineage(start_id int)
RETURNS TABLE (id int, parent_id int, depth int) AS $$
    WITH RECURSIVE chain AS (
        SELECT mv.id, mv.parent_id, 0 AS depth FROM model_versions mv WHERE mv.id = start_id
        UNION ALL
        SELECT mv.id, mv.parent_id, c.depth + 1
        FROM model_versions mv JOIN chain c ON mv.id = c.parent_id
    )
    SELECT * FROM chain;
$$ LANGUAGE sql STABLE;
