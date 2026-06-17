from __future__ import annotations

import os
import shutil
import threading
import time
from http.server import ThreadingHTTPServer
from typing import Any

from memory_anki.supervisor.runtime_supervisor_support import ensure_supervisor_directories


def publish_worker(supervisor: Any, *, promote_immediately: bool) -> None:
    try:
        supervisor._publish_release(promote_immediately=promote_immediately)
    except Exception as exc:
        with supervisor.lock:
            supervisor.last_publish_error = str(exc)
            supervisor.last_failed_fingerprint = supervisor._compute_source_fingerprint()
            supervisor.save_state()
    finally:
        with supervisor.lock:
            supervisor._set_building_locked(False)


def trigger_publish(supervisor: Any, *, promote_immediately: bool = False) -> None:
    with supervisor.lock:
        if supervisor.building:
            return
        supervisor._set_building_locked(True)
    thread = threading.Thread(
        target=supervisor._publish_worker,
        kwargs={"promote_immediately": promote_immediately},
        name="memory-anki-release-build",
        daemon=True,
    )
    thread.start()


def watch_builds_disabled() -> bool:
    raw_value = str(os.environ.get("MEMORY_ANKI_DISABLE_WATCH_BUILDS") or "").strip().lower()
    return raw_value in {"1", "true", "yes", "on"}


def watch_loop(supervisor: Any) -> None:
    while not supervisor.stop_event.wait(supervisor.config.poll_interval_seconds):
        fingerprint = supervisor._compute_source_fingerprint()
        with supervisor.lock:
            if fingerprint == supervisor.last_repo_fingerprint:
                pass
            elif fingerprint == supervisor.last_blocked_fingerprint:
                pass
            elif fingerprint == supervisor.last_failed_fingerprint:
                pass
            elif supervisor.candidate_release_id:
                pass
            elif supervisor._watch_builds_disabled():
                pass
            elif not supervisor.building:
                supervisor._set_building_locked(True)
                threading.Thread(
                    target=supervisor._publish_worker,
                    kwargs={"promote_immediately": False},
                    name="memory-anki-release-watch-build",
                    daemon=True,
                ).start()
        supervisor._cleanup_releases()


def cleanup_releases(supervisor: Any) -> None:
    now = time.time()
    with supervisor.lock:
        removable: list[str] = []
        for release_id, release in supervisor.releases.items():
            if release_id in {supervisor.current_release_id, supervisor.candidate_release_id}:
                continue
            if release.retired_at is None:
                continue
            sessions = supervisor.release_sessions.get(release_id, {})
            sessions = {
                session_key: last_seen
                for session_key, last_seen in sessions.items()
                if now - last_seen <= supervisor.config.session_grace_seconds
            }
            supervisor.release_sessions[release_id] = sessions
            should_remove = not sessions and now - release.retired_at >= supervisor.config.retired_release_ttl_seconds
            if should_remove:
                removable.append(release_id)
        for release_id in removable:
            supervisor._stop_release_process(release_id)
            release = supervisor.releases.pop(release_id, None)
            supervisor.release_sessions.pop(release_id, None)
            if release:
                shutil.rmtree(release.path, ignore_errors=True)
        if removable:
            supervisor.save_state()
    supervisor._reconcile_orphan_releases()


def start(supervisor: Any) -> None:
    ensure_supervisor_directories(supervisor.config)
    supervisor.load_state()
    supervisor._reconcile_orphan_releases()
    restored = supervisor._restore_saved_release(supervisor.current_release_id)
    if restored and supervisor.candidate_release_id:
        candidate_restored = supervisor._restore_saved_release(supervisor.candidate_release_id)
        with supervisor.lock:
            if not candidate_restored:
                supervisor._drop_candidate_release()
    if not restored:
        supervisor.trigger_publish(promote_immediately=True)
        while True:
            with supervisor.lock:
                ready = bool(supervisor.current_release_id and supervisor.current_release_id in supervisor.releases)
                building = supervisor.building
                error = supervisor.last_publish_error
            if ready and not building:
                break
            if error and not building:
                raise RuntimeError(error)
            time.sleep(0.5)

    repo_fingerprint = supervisor._compute_source_fingerprint()
    with supervisor.lock:
        if not supervisor.last_repo_fingerprint:
            supervisor.last_repo_fingerprint = repo_fingerprint
            supervisor.save_state()
        elif (
            repo_fingerprint != supervisor.last_repo_fingerprint
            and repo_fingerprint != supervisor.last_failed_fingerprint
            and not supervisor.candidate_release_id
            and not supervisor.building
            and not supervisor._watch_builds_disabled()
        ):
            supervisor._set_building_locked(True)
            threading.Thread(
                target=supervisor._publish_worker,
                kwargs={"promote_immediately": False},
                daemon=True,
                name="memory-anki-startup-candidate-build",
            ).start()

    watcher = threading.Thread(target=supervisor._watch_loop, daemon=True, name="memory-anki-supervisor-watch")
    watcher.start()
    supervisor.server = ThreadingHTTPServer((supervisor.config.host, supervisor.config.port), supervisor.make_handler())
    try:
        supervisor.server.serve_forever(poll_interval=0.5)
    finally:
        supervisor.stop_event.set()
        supervisor.shutdown()


def shutdown(supervisor: Any) -> None:
    if supervisor.server:
        try:
            supervisor.server.server_close()
        except Exception:
            pass
    with supervisor.lock:
        release_ids = list(supervisor.release_processes.keys())
    for release_id in release_ids:
        supervisor._stop_release_process(release_id)
    supervisor.save_state()
