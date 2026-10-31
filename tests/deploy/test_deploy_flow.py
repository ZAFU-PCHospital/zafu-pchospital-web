"""End-to-end deploy-prod.sh tests against local stand-ins only."""
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEPLOY_DIR = ROOT / "tools/deploy"
FAKE_ENV = Path(__file__).with_name("fake_env.py")


def find_bash():
    if os.name == "nt":
        candidate = Path(os.environ.get("ProgramFiles", "C:/Program Files")) / "Git/bin/bash.exe"
        if candidate.exists():
            return str(candidate)
    return shutil.which("bash")


BASH = find_bash()

SCHEMA = """generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}

model User {
  id String @id @db.VarChar(36)
}
"""

SCHEMA_WIDGET = SCHEMA + "\nmodel Widget {\n  id String @id\n}\n"

SCHEMA_FORMATTED = """generator client {
    provider = "prisma-client"
    output = "../src/generated/prisma"
}

datasource db {
    provider = "mysql"
    url = env("DATABASE_URL")
}

model User {
    id String @id @db.VarChar(36)
}
"""


def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def add_bytes(archive, name, content):
    data = content.encode("utf-8")
    info = tarfile.TarInfo(name)
    info.size = len(data)
    import io

    archive.addfile(info, io.BytesIO(data))


class DeploySandbox:
    def __init__(self, root, kind, fetch_ok=False):
        self.root = Path(root)
        self.kind = kind
        self.fetch_ok = fetch_ok
        self.repo = self.root / "repo"
        self.app = self.root / "server/opt/zafu-pchospital-web"
        self.tmp = self.root / "server/tmp"
        self.backups = self.root / "server/opt/zafu-pchospital-backups"
        self.db_state = self.root / "db"
        self.systemd = self.root / "systemd"
        self.events = self.root / "events.jsonl"
        self.build = self.root / "build"
        self.runner = self.root / "runner.sh"
        self.log = self.root / "deploy.log"
        self._prepare()

    def git(self, *args, cwd=None, check=True):
        return subprocess.run(
            ["git", *args],
            cwd=cwd or self.repo,
            check=check,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )

    def make_docs_source(self, unreachable=False):
        """Create a docs checkout whose origin/main is one commit ahead."""
        remote = self.root / "docs-remote.git"
        work = self.root / "docs-work"
        checkout = self.root / "docs-checkout"
        self.git("init", "--bare", "--initial-branch=main", str(remote), cwd=self.root)
        work.mkdir()
        self.git("init", "-b", "main", cwd=work)
        self.git("config", "core.autocrlf", "false", cwd=work)
        self.git("config", "user.name", "Docs Fixture", cwd=work)
        self.git("config", "user.email", "docs@fixture.invalid", cwd=work)
        write(work / "theme/pc-hospital.css", "/* docs theme */\n")
        write(work / "theme/pc-hospital.js", "// docs theme\n")
        write(work / "src/SUMMARY.md", "# Summary\n\n- [Page](Page.md)\n")
        write(work / "src/Page.md", "# Page\n")
        self.git("add", ".", cwd=work)
        self.git("commit", "-m", "docs old", cwd=work)
        self.git("remote", "add", "origin", str(remote), cwd=work)
        self.git("push", "-u", "origin", "main", cwd=work)
        old = self.git("rev-parse", "HEAD", cwd=work).stdout.strip()

        self.git(
            "-c",
            "core.autocrlf=false",
            "clone",
            str(remote),
            str(checkout),
            cwd=self.root,
        )
        self.git("config", "core.autocrlf", "false", cwd=checkout)

        write(work / "src/New.md", "# New\n")
        self.git("add", ".", cwd=work)
        self.git("commit", "-m", "docs new", cwd=work)
        self.git("push", "origin", "main", cwd=work)
        new = self.git("rev-parse", "HEAD", cwd=work).stdout.strip()

        if unreachable:
            self.git(
                "remote",
                "set-url",
                "origin",
                "http://127.0.0.1:9/unreachable.git",
                cwd=checkout,
            )
        return checkout, old, new

    def _prepare(self):
        for folder in (self.repo, self.tmp, self.backups, self.db_state, self.systemd, self.build):
            folder.mkdir(parents=True, exist_ok=True)
        shutil.copytree(DEPLOY_DIR, self.repo / "tools/deploy")
        shutil.copy2(ROOT / ".gitignore", self.repo / ".gitignore")
        write(self.repo / "README.md", "# fixture\n")
        # 让 public/ 被 Git 跟踪，避免第二次部署时未跟踪的 handbook.old 被折叠成 "?? public/"
        write(self.repo / "public/.gitkeep", "\n")
        write(self.repo / "prisma/schema.prisma", SCHEMA)
        write(self.repo / "prisma/seed.ts", "export {};\n")
        write(self.repo / "prisma.config.ts", "export default {};\n")
        write(self.repo / "prisma/migrations/migration_lock.toml", 'provider = "mysql"\n')
        for name in ("20260101000000_init", "20260102000000_base"):
            write(self.repo / f"prisma/migrations/{name}/migration.sql", "CREATE TABLE `fixture` (`id` int);\n")

        self.git("init", "-b", "main")
        self.git("config", "core.autocrlf", "false")
        self.git("config", "core.eol", "lf")
        self.git("config", "user.name", "Deploy Fixture")
        self.git("config", "user.email", "deploy@fixture.invalid")
        self.git("add", ".")
        self.git("commit", "-m", "old release")
        self.old = self.git("rev-parse", "HEAD").stdout.strip()

        if self.kind in ("db", "schema_applied"):
            write(
                self.repo / "prisma/migrations/20260103000000_add_widget/migration.sql",
                "CREATE TABLE `widget` (`id` int NOT NULL, PRIMARY KEY (`id`));\n",
            )
        if self.kind in ("db", "schema_applied", "schema_without_migration", "schema_pending_existing"):
            write(self.repo / "prisma/schema.prisma", SCHEMA_WIDGET)
        if self.kind == "schema_format":
            write(self.repo / "prisma/schema.prisma", SCHEMA_FORMATTED)
        if self.kind == "db":
            write(self.repo / "prisma/seed.ts", "export {};\n// seed changed\n")
        if self.kind in ("db_failed", "db_rolled", "db_drift", "pending_existing", "pure"):
            write(self.repo / "src/feature.ts", "export const feature = 'pure code';\n")

        self.git("add", ".")
        self.git("commit", "-m", f"target release ({self.kind})")
        self.target = self.git("rev-parse", "HEAD").stdout.strip()

        bare = self.root / "remote.git"
        subprocess.run(
            ["git", "init", "--bare", "--initial-branch=main", str(bare)],
            check=True,
            capture_output=True,
        )
        self.git("remote", "add", "origin", str(bare))
        self.git("push", "-u", "origin", "main")

        self.app.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            [
                "git",
                "-c",
                "core.autocrlf=false",
                "-c",
                "core.eol=lf",
                "clone",
                str(bare),
                str(self.app),
            ],
            check=True,
            capture_output=True,
        )
        self.git("config", "core.autocrlf", "false", cwd=self.app)
        self.git("config", "core.eol", "lf", cwd=self.app)
        self.git("reset", "--hard", "HEAD", cwd=self.app)
        self.git("checkout", "--detach", self.old, cwd=self.app)
        origin = str(bare) if self.fetch_ok else "http://127.0.0.1:9/unreachable.git"
        self.git("remote", "set-url", "origin", origin, cwd=self.app)
        write(self.app / ".next/BUILD_ID", "old-build-id\n")
        write(self.app / ".next/DEPLOY_COMMIT", f"commit={self.old}\nbuild_id=old-build-id\n")
        write(self.app / "public/handbook/index.html", "<html>old</html>\n")
        # 与生产 /var/lib/docs-sync 一样放在应用目录之外，避免触发 P1 脏工作区检查。
        self.docs_sync_state = self.root / "docs-sync" / "deployed-sha"
        write(self.docs_sync_state, "old-docs-sha\n")

        write(self.root / "server/opt/zafu-pchospital-db/.env", "GREATSQL_ROOT_PASSWORD=fixture-root\n")
        for unit in ("zafu-pchospital-web", "docs-sync.timer", "docs-sync.service"):
            write(self.systemd / f"{unit}.state", "active")
        write(self.root / "gitconfig", "")

        applied = ["20260101000000_init", "20260102000000_base"]
        extra = []
        if self.kind in ("pending_existing", "schema_pending_existing"):
            applied = applied[:1]
        elif self.kind == "schema_applied":
            applied = applied + ["20260103000000_add_widget"]
        elif self.kind == "db_failed":
            extra = ["20260103000000_add_widget||"]
        elif self.kind == "db_rolled":
            extra = ["20260103000000_add_widget|2026-01-01T00:00:00Z|2026-01-02T00:00:00Z"]
        elif self.kind == "db_drift":
            extra = ["20269999000000_unknown|2026-01-01T00:00:00Z|"]
        with (self.db_state / "migrations.txt").open("w", encoding="utf-8") as stream:
            for name in applied:
                stream.write(f"{name}|2026-01-01T00:00:00Z|\n")
            for line in extra:
                stream.write(line + "\n")

        self.build_id = f"fixture-build-{self.target[:10]}"
        artifact = self.build / f"pc-artifact-{self.target}.tar.gz"
        with tarfile.open(artifact, "w:gz") as archive:
            add_bytes(archive, ".next/BUILD_ID", self.build_id + "\n")
            add_bytes(archive, "public/handbook/index.html", "<html>new</html>\n")
            add_bytes(
                archive,
                "BUILD_COMMIT",
                f"commit={self.target}\nbuilt_at=2026-01-01T00:00:00Z\nnode=v22.12.0\n"
                f"mdbook=mdbook v0.5.4\nbuild_id={self.build_id}\n"
                "docs_revision=fixture-cache-docs\n",
            )

        fake = self.root / "fake_env.py"
        shutil.copy2(FAKE_ENV, fake)
        python = Path(sys.executable).as_posix()
        common = (
            f'FAKE_PYTHON="{python}"\n'
            f'FAKE_ENV="{fake.as_posix()}"\n'
            'fake_tool() { "$FAKE_PYTHON" "$FAKE_ENV" "$1" "${@:2}"; }\n'
        )
        write(
            self.root / "shims.sh",
            common
            + "".join(f'{tool}() {{ fake_tool {tool} "$@"; }}\n' for tool in ("ssh", "scp", "node", "pnpm", "mdbook", "curl")),
        )
        write(
            self.root / "remote-shims.sh",
            common
            + "".join(
                f'{tool}() {{ fake_tool {tool} "$@"; }}\n'
                for tool in ("systemctl", "docker", "curl", "pnpm", "node", "mdbook", "chown", "free", "df", "timeout")
            ),
        )
        write(
            self.runner,
            '#!/usr/bin/env bash\n'
            f'source "{(self.root / "shims.sh").as_posix()}"\n'
            f'source "{(self.repo / "tools/deploy/deploy-prod.sh").as_posix()}" "$@"\n',
        )

    def make_target_script_change(self):
        """Commit a target-only deploy script change, then check out the old clean tree."""
        script = self.repo / "tools/deploy/deploy-prod.sh"
        script.write_text(
            script.read_text(encoding="utf-8") + "\n# target-only deploy script change\n",
            encoding="utf-8",
        )
        self.git("add", "tools/deploy/deploy-prod.sh")
        self.git("commit", "-m", "target deploy script change")
        self.target = self.git("rev-parse", "HEAD").stdout.strip()
        self.git("push", "origin", "main")
        self.git("checkout", "--detach", self.old)
        return self.target

    def run_deploy(self, fail_path="", extra_args=(), db_plan_fail=False):
        env = os.environ.copy()
        env.pop("WHALE_NOTIFY_CONFIG", None)
        env.pop("FAKE_CURL_FAIL_PATH", None)
        env.pop("FAKE_DB_PLAN_FAIL", None)
        env.update(
            {
                "DEPLOY_HOST": "fixture@example.invalid",
                "WHALE_NOTIFY_DISABLED": "1",
                "WHALE_NOTIFY_PYTHON": Path(sys.executable).as_posix(),
                "PYTHONUTF8": "1",
                "FAKE_SANDBOX": self.root.as_posix(),
                "FAKE_APP_DIR": self.app.as_posix(),
                "FAKE_SERVER_TMP": self.tmp.as_posix(),
                "FAKE_DB_STATE": self.db_state.as_posix(),
                "FAKE_SYSTEMD_STATE": self.systemd.as_posix(),
                "FAKE_EVENTS": self.events.as_posix(),
                "FAKE_BASH": BASH,
                "DEPLOY_FETCH_TIMEOUT": "2",
                "DEPLOY_FETCH_ATTEMPTS": "1",
                "DEPLOY_DOCS_FETCH_TIMEOUT": "1",
                "DEPLOY_DOCS_FETCH_ATTEMPTS": "1",
                "DEPLOY_DOCS_SOURCE_FETCH_ATTEMPTS": "1",
            }
        )
        if fail_path:
            # Git Bash converts path-like env values for native Python; keep it slash-free.
            env["FAKE_CURL_FAIL_PATH"] = fail_path.strip("/")
        if db_plan_fail:
            env["FAKE_DB_PLAN_FAIL"] = "1"
        completed = subprocess.run(
            [
                BASH,
                str(self.runner),
                "--yes",
                "--host",
                "fixture@example.invalid",
                "--build-dir",
                self.build.as_posix(),
                "--log",
                self.log.as_posix(),
                "--base",
                "https://example.test",
                *extra_args,
            ],
            cwd=self.repo,
            env=env,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=180,
        )
        log = self.log.read_text(encoding="utf-8", errors="replace") if self.log.exists() else ""
        return completed, log + "\n" + completed.stdout + completed.stderr

    def server_head(self):
        return self.git("rev-parse", "HEAD", cwd=self.app).stdout.strip()

    def server_handbook(self):
        return (self.app / "public/handbook/index.html").read_text(encoding="utf-8")

    def service_state(self, unit="zafu-pchospital-web"):
        return (self.systemd / f"{unit}.state").read_text(encoding="utf-8").strip()

    def service_stops(self):
        if not self.events.exists():
            return []
        rows = [json.loads(line) for line in self.events.read_text(encoding="utf-8").splitlines() if line]
        return [row for row in rows if row["unit"] == "zafu-pchospital-web" and row["action"] == "inactive"]

    def notification(self):
        spool = self.repo / ".runtime/deploy-notifications"
        files = [path for path in spool.glob("*.json") if not path.name.startswith("attempt-")]
        if len(files) != 1:
            raise AssertionError(f"expected one notification, found {files}")
        return json.loads(files[0].read_text(encoding="utf-8"))


@unittest.skipUnless(BASH, "Bash is required for deploy flow tests")
class DeployFlowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)

    def sandbox(self, kind, name=None, fetch_ok=False):
        return DeploySandbox(Path(self.temp.name) / (name or kind), kind, fetch_ok=fetch_ok)

    def test_pure_code_skips_database_stage_and_uses_bundle(self):
        sandbox = self.sandbox("pure")
        completed, log = sandbox.run_deploy()
        self.assertEqual(completed.returncode, 0, log)
        self.assertIn("改用本地 bundle", log)
        self.assertIn("纯代码发布：跳过停机阶段", log)
        self.assertIn("数据库阶段：跳过", log)
        self.assertNotIn("迁移前快照", log)
        self.assertIn("阶段耗时（本地墙钟）", log)
        self.assertEqual(sandbox.server_head(), sandbox.target)
        self.assertEqual(len(sandbox.service_stops()), 1)
        self.assertTrue((sandbox.app / ".next.old/BUILD_ID").exists())
        self.assertTrue((sandbox.app / "public/handbook.old/index.html").exists())
        self.assertFalse(sandbox.docs_sync_state.exists())
        payload = sandbox.notification()
        self.assertEqual(payload["status"], "success")
        self.assertEqual(payload["smoke"], "passed")
        self.assertEqual(payload["commit"], sandbox.target)

    def test_database_change_runs_migration_and_seed(self):
        sandbox = self.sandbox("db")
        completed, log = sandbox.run_deploy()
        self.assertEqual(completed.returncode, 0, log)
        self.assertIn("待应用迁移：", log)
        self.assertIn("待应用迁移 1 个", log)
        self.assertIn("schema.prisma 实质变化：是", log)
        self.assertIn("schema.prisma 有变化且新迁移待应用", log)
        self.assertIn("迁移前快照", log)
        self.assertIn("pnpm db:migrate:deploy", log)
        self.assertIn("seed（幂等）", log)
        self.assertIn("迁移后核对", log)
        self.assertIn("已应用 3 / 目录 3", log)
        self.assertEqual(len(sandbox.service_stops()), 1)
        migrations = (sandbox.db_state / "migrations.txt").read_text(encoding="utf-8").splitlines()
        self.assertEqual(len(migrations), 3)
        payload = sandbox.notification()
        self.assertEqual(payload["status"], "success")
        self.assertEqual(payload["commit"], sandbox.target)

    def test_existing_pending_migration_is_not_mistaken_for_pure_code(self):
        sandbox = self.sandbox("pending_existing")
        completed, log = sandbox.run_deploy()
        self.assertEqual(completed.returncode, 0, log)
        self.assertIn("本次没有新增迁移文件", log)
        self.assertIn("20260102000000_base", log)
        self.assertIn("待应用迁移 1 个", log)
        self.assertIn("迁移前快照", log)
        self.assertNotIn("纯代码发布：无待应用迁移", log)
        self.assertEqual(len(sandbox.service_stops()), 1)
        migrations = (sandbox.db_state / "migrations.txt").read_text(encoding="utf-8").splitlines()
        self.assertEqual(len(migrations), 2)
        self.assertEqual(sandbox.notification()["status"], "success")

    def test_schema_change_without_migration_stops_before_downtime(self):
        sandbox = self.sandbox("schema_without_migration")
        completed, log = sandbox.run_deploy()
        self.assertNotEqual(completed.returncode, 0, log)
        self.assertIn("schema.prisma 有实质变化，但目标提交没有新增迁移", log)
        self.assertIn("部署在 [P2] 中断", log)
        self.assertEqual(sandbox.server_head(), sandbox.old)
        self.assertEqual(sandbox.service_state(), "active")
        self.assertEqual(sandbox.service_state("docs-sync.timer"), "active")
        self.assertEqual(sandbox.service_stops(), [])
        payload = sandbox.notification()
        self.assertEqual(payload["status"], "failed")
        self.assertEqual(payload["smoke"], "not_run")

    def test_schema_change_with_applied_new_migration_is_allowed(self):
        sandbox = self.sandbox("schema_applied")
        completed, log = sandbox.run_deploy()
        self.assertEqual(completed.returncode, 0, log)
        self.assertIn("schema 变化已由本次新增迁移覆盖", log)
        self.assertIn("数据库阶段：跳过", log)
        self.assertNotIn("迁移前快照", log)
        self.assertEqual(sandbox.server_head(), sandbox.target)
        self.assertEqual(sandbox.notification()["status"], "success")

    def test_schema_format_only_is_not_a_database_change(self):
        sandbox = self.sandbox("schema_format")
        completed, log = sandbox.run_deploy()
        self.assertEqual(completed.returncode, 0, log)
        self.assertIn("schema.prisma 实质变化：否", log)
        self.assertIn("纯代码发布", log)
        self.assertNotIn("目标提交没有新增迁移", log)
        self.assertEqual(sandbox.server_head(), sandbox.target)
        self.assertEqual(sandbox.notification()["status"], "success")

    def test_schema_change_without_new_migration_aborts_despite_existing_pending(self):
        sandbox = self.sandbox("schema_pending_existing")
        completed, log = sandbox.run_deploy()
        self.assertNotEqual(completed.returncode, 0, log)
        self.assertIn("schema.prisma 有实质变化，但目标提交没有新增迁移", log)
        self.assertIn("部署在 [P2] 中断", log)
        self.assertEqual(sandbox.server_head(), sandbox.old)
        self.assertEqual(sandbox.service_state(), "active")
        self.assertEqual(sandbox.service_state("docs-sync.timer"), "active")
        self.assertEqual(sandbox.service_stops(), [])
        self.assertEqual(sandbox.notification()["status"], "failed")

    def test_database_state_read_failure_falls_back_to_db_stage(self):
        sandbox = self.sandbox("pure", name="db_unreadable")
        completed, log = sandbox.run_deploy(db_plan_fail=True)
        self.assertEqual(completed.returncode, 0, log)
        self.assertIn("无法读取 _prisma_migrations", log)
        self.assertIn("无法确认数据库已应用版本", log)
        self.assertIn("迁移前快照", log)
        self.assertIn("已应用 2 / 目录 2", log)
        self.assertEqual(sandbox.server_head(), sandbox.target)
        self.assertEqual(sandbox.notification()["status"], "success")

    def test_schema_without_migration_can_be_explicitly_allowed(self):
        sandbox = self.sandbox("schema_without_migration", name="schema_allowed")
        completed, log = sandbox.run_deploy(extra_args=["--allow-schema-without-migration"])
        self.assertEqual(completed.returncode, 0, log)
        self.assertIn("已用 --allow-schema-without-migration 放行", log)
        self.assertIn("数据库阶段：跳过", log)
        self.assertEqual(sandbox.server_head(), sandbox.target)
        self.assertEqual(sandbox.notification()["status"], "success")

    def test_migration_anomalies_abort_before_downtime(self):
        cases = (
            ("db_failed", "数据库存在失败或已回滚的迁移记录"),
            ("db_rolled", "数据库存在失败或已回滚的迁移记录"),
            ("db_drift", "数据库已应用了目标提交里不存在的迁移"),
        )
        for kind, marker in cases:
            with self.subTest(kind=kind):
                sandbox = self.sandbox(kind, name=kind)
                completed, log = sandbox.run_deploy()
                self.assertNotEqual(completed.returncode, 0, log)
                self.assertIn(marker, log)
                self.assertEqual(sandbox.server_head(), sandbox.old)
                self.assertEqual(sandbox.service_state(), "active")
                self.assertEqual(sandbox.service_state("docs-sync.timer"), "active")
                self.assertEqual(sandbox.service_stops(), [])
                self.assertEqual(sandbox.notification()["status"], "failed")

    def test_fetch_success_path(self):
        sandbox = self.sandbox("pure", name="fetch_ok", fetch_ok=True)
        completed, log = sandbox.run_deploy()
        self.assertEqual(completed.returncode, 0, log)
        self.assertIn("服务器 fetch 成功", log)
        self.assertNotIn("改用本地 bundle", log)
        self.assertEqual(sandbox.server_head(), sandbox.target)
        self.assertEqual(sandbox.notification()["status"], "success")

    def test_local_script_mismatch_aborts_before_server_contact(self):
        sandbox = self.sandbox("pure", name="script_dirty")
        script = sandbox.repo / "tools/deploy/deploy-prod.sh"
        script.write_text(
            script.read_text(encoding="utf-8") + "\n# local uncommitted patch\n",
            encoding="utf-8",
        )
        completed, log = sandbox.run_deploy()
        self.assertNotEqual(completed.returncode, 0, log)
        self.assertIn("标准路径的 deploy-prod.sh 与目标提交", log)
        self.assertIn("--allow-local-script", log)
        self.assertEqual(sandbox.server_head(), sandbox.old)
        self.assertEqual(sandbox.service_state(), "active")
        self.assertEqual(sandbox.service_stops(), [])
        self.assertEqual(sandbox.notification()["status"], "failed")

    def test_old_standard_path_script_in_clean_worktree_aborts(self):
        """Target changes the standard-path script while the clean worktree is at the old commit."""
        sandbox = self.sandbox("pure", name="script_old")
        sandbox.make_target_script_change()
        self.assertEqual(sandbox.git("status", "--porcelain").stdout.strip(), "")
        completed, log = sandbox.run_deploy()
        self.assertNotEqual(completed.returncode, 0, log)
        self.assertIn("标准路径的 deploy-prod.sh 与目标提交", log)
        self.assertEqual(sandbox.server_head(), sandbox.old)
        self.assertEqual(sandbox.service_stops(), [])

    def test_allow_local_script_warns_and_proceeds(self):
        sandbox = self.sandbox("pure", name="script_allowed")
        script = sandbox.repo / "tools/deploy/deploy-prod.sh"
        script.write_text(
            script.read_text(encoding="utf-8") + "\n# local uncommitted patch\n",
            encoding="utf-8",
        )
        completed, log = sandbox.run_deploy(extra_args=("--allow-local-script",))
        self.assertEqual(completed.returncode, 0, log)
        self.assertIn("--allow-local-script 显式放行", log)
        self.assertEqual(sandbox.server_head(), sandbox.target)
        self.assertEqual(sandbox.notification()["status"], "success")

    def test_explicit_docs_source_is_updated_before_build(self):
        sandbox = self.sandbox("pure", name="docs_update")
        docs, _old, new = sandbox.make_docs_source()
        completed, log = sandbox.run_deploy(extra_args=("--docs-source", docs.as_posix()))
        self.assertEqual(completed.returncode, 0, log)
        self.assertIn("文档源码已更新", log)
        self.assertEqual(sandbox.git("rev-parse", "HEAD", cwd=docs).stdout.strip(), new)
        self.assertEqual(sandbox.server_head(), sandbox.target)
        self.assertFalse(sandbox.docs_sync_state.exists())

    def test_docs_revision_change_invalidates_cached_artifact(self):
        sandbox = self.sandbox("pure", name="docs_cache")
        docs, _old, new = sandbox.make_docs_source()

        completed, log = sandbox.run_deploy(extra_args=("--docs-source", docs.as_posix()))
        self.assertEqual(completed.returncode, 0, log)
        self.assertIn("已有产物与当前文档源码不一致", log)
        self.assertNotIn("发现同提交且同文档修订的已有产物", log)
        self.assertEqual(sandbox.server_handbook(), f"<html>docs={new}</html>\n")

    def test_same_code_and_docs_revision_reuses_artifact(self):
        sandbox = self.sandbox("pure", name="docs_cache_reuse", fetch_ok=True)
        docs, _old, new = sandbox.make_docs_source()

        completed, log = sandbox.run_deploy(extra_args=("--docs-source", docs.as_posix()))
        self.assertEqual(completed.returncode, 0, log)
        completed, log = sandbox.run_deploy(
            extra_args=("--docs-source", docs.as_posix(), "--redeploy")
        )
        self.assertEqual(completed.returncode, 0, log)
        self.assertIn("发现同提交且同文档修订的已有产物", log)
        self.assertNotIn("重新构建", log)
        self.assertEqual(sandbox.server_handbook(), f"<html>docs={new}</html>\n")

    def test_stale_docs_source_aborts_by_default_and_can_be_allowed(self):
        sandbox = self.sandbox("pure", name="docs_stale")
        docs, _old, _new = sandbox.make_docs_source(unreachable=True)

        completed, log = sandbox.run_deploy(extra_args=("--docs-source", docs.as_posix()))
        self.assertNotEqual(completed.returncode, 0, log)
        self.assertIn("文档源码未能更新到 origin/main", log)
        self.assertIn("--allow-stale-docs", log)
        self.assertEqual(sandbox.server_head(), sandbox.old)
        self.assertEqual(sandbox.service_stops(), [])
        self.assertTrue(sandbox.docs_sync_state.exists())

        completed, log = sandbox.run_deploy(
            extra_args=("--docs-source", docs.as_posix(), "--allow-stale-docs")
        )
        self.assertEqual(completed.returncode, 0, log)
        self.assertIn("--allow-stale-docs 放行", log)
        self.assertEqual(sandbox.server_head(), sandbox.target)
        self.assertFalse(sandbox.docs_sync_state.exists())

    def test_smoke_failure_returns_nonzero_and_restores_timer(self):
        sandbox = self.sandbox("pure")
        completed, log = sandbox.run_deploy(fail_path="/about")
        self.assertNotEqual(completed.returncode, 0, log)
        self.assertIn("/about -> 500", log)
        self.assertEqual(sandbox.service_state(), "active")
        self.assertEqual(sandbox.service_state("docs-sync.timer"), "active")
        payload = sandbox.notification()
        self.assertEqual(payload["status"], "failed")
        self.assertEqual(payload["smoke"], "failed")
        self.assertEqual(payload["commit"], sandbox.target)


if __name__ == "__main__":
    unittest.main()
