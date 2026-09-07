import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import StageLights from '../components/StageLights';

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function UploadForm({ projectId, projectType, onCreated, onCancel }) {
  const [version, setVersion] = useState('');
  const [note, setNote] = useState('');
  const [releaseDate, setReleaseDate] = useState(todayStr());
  const [binFile, setBinFile] = useState(null);
  const [zipFile, setZipFile] = useState(null);
  const [zip2File, setZip2File] = useState(null);
  const [exeFile, setExeFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const isApp = projectType === 'app';

  async function onSubmit(e) {
    e.preventDefault();
    if (isApp) {
            if (exeFile) {
        exeUpload = await drive.uploadFile(
          exeFile.path,
          `${versionTag}_${exeFile.originalname}`,
          'application/octet-stream',   // ← consider 'application/vnd.android.package-archive'
          folderId
        );
      }
    } else if (!binFile) {
      setError('Please attach a .bin file.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('version', version);
      fd.append('note', note);
      fd.append('release_date', releaseDate);
      if (binFile) fd.append('bin', binFile);
      if (zipFile) fd.append('zip', zipFile);
      if (zip2File) fd.append('zip2', zip2File);
      if (exeFile) fd.append('exe', exeFile);
      await api.createRelease(projectId, fd);
      setVersion('');
      setNote('');
      setReleaseDate(todayStr());
      setBinFile(null);
      setZipFile(null);
      setZip2File(null);
      setExeFile(null);
      e.target.reset();
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <div className="section-title">Release new {isApp ? 'build' : 'firmware'}</div>
      {error && <div className="error-box">{error}</div>}
      <form onSubmit={onSubmit}>
        <div className="field-row">
          <div className="field">
            <label>Version</label>
            <input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="e.g. v2.4.1" required />
          </div>
          <div className="field">
            <label>Date of release</label>
            <input type="date" value={releaseDate} onChange={(e) => setReleaseDate(e.target.value)} required />
          </div>
        </div>
        <div className="field-row">
          {isApp ? (
            <>
              <div className="field">
                <label>.zip file</label>
                <input type="file" accept=".zip" onChange={(e) => setZipFile(e.target.files[0])} required />
              </div>
              <div className="field">
                <label>.apk file</label>
                <input type="file" accept=".apk" onChange={(e) => setExeFile(e.target.files[0])} required />
              </div>
            </>
          ) : (
            <>
              <div className="field">
                <label>.bin file</label>
                <input type="file" accept=".bin" onChange={(e) => setBinFile(e.target.files[0])} required />
              </div>
              <div className="field">
                <label>Firmware ZIP (optional)</label>
                <input type="file" accept=".zip" onChange={(e) => setZipFile(e.target.files[0])} />
              </div>
              <div className="field">
                <label>Holtek ZIP (optional)</label>
                <input type="file" accept=".zip" onChange={(e) => setZip2File(e.target.files[0])} />
              </div>
            </>
          )}
        </div>
        <div className="field">
          <label>Release note</label>
          <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What changed in this build…" />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? 'Uploading to Drive…' : 'Publish release'}
          </button>
          <button className="btn ghost" type="button" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

function StageEditor({ release, onUpdated }) {
  const [openStage, setOpenStage] = useState(null);
  const [remarks, setRemarks] = useState('');
  const [date, setDate] = useState(todayStr());
  const [busy, setBusy] = useState(false);

  function openFor(stageNumber) {
    setOpenStage(openStage === stageNumber ? null : stageNumber);
    setRemarks('');
    setDate(todayStr());
  }

  async function submit(stageNumber, status) {
    setBusy(true);
    try {
      await api.updateStage(release.id, stageNumber, status, remarks, date);
      setOpenStage(null);
      setRemarks('');
      onUpdated();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stage-list">
      {release.stages.map((s) => (
        <div key={s.stage_number}>
          <div className="stage-row">
            <span className="stage-num mono">{s.stage_number}</span>
            <span className="stage-name">{s.stage_name}</span>
            {s.remarks && <span className="stage-remarks">"{s.remarks}"</span>}
            <span className={`status-pill ${s.status}`}>{s.status}</span>
            {s.can_update && (
              <button className="btn small ghost" onClick={() => openFor(s.stage_number)}>
                Update
              </button>
            )}
          </div>
          {openStage === s.stage_number && (
            <div className="panel" style={{ marginTop: 6, marginBottom: 6 }}>
              <div className="field-row">
                <div className="field" style={{ flex: 2 }}>
                  <label>Remarks</label>
                  <textarea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Testing notes / reason…" />
                </div>
                <div className="field" style={{ flex: 1 }}>
                  <label>Date</label>
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn primary" disabled={busy} onClick={() => submit(s.stage_number, 'passed')}>
                  Mark passed
                </button>
                <button className="btn" disabled={busy} onClick={() => submit(s.stage_number, 'failed')}>
                  Mark failed
                </button>
                <button className="btn ghost" disabled={busy} onClick={() => submit(s.stage_number, 'pending')}>
                  Reset to pending
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ReleaseDetail({ release, isAdmin, onUpdated, onDeleted }) {
  const [downloading, setDownloading] = useState('');
  const [deleting, setDeleting] = useState(false);

  async function download(fileType) {
    setDownloading(fileType);
    try {
      await api.downloadFile(release.id, fileType);
    } catch (err) {
      alert(err.message);
    } finally {
      setDownloading('');
    }
  }

  async function handleDelete() {
    const ok = window.confirm(`Delete release ${release.version}? This cannot be undone.`);
    if (!ok) return;
    setDeleting(true);
    try {
      await api.deleteRelease(release.id);
      onDeleted();
    } catch (err) {
      alert(err.message);
      setDeleting(false);
    }
  }

  return (
    <div className="panel release-card">
      <div className="release-header">
        <div>
          <span className="release-version">{release.version}</span>
          <div className="release-meta">
            Date of Release: {new Date(release.release_date || release.created_at).toLocaleDateString()}
          </div>
          {release.approved_at && (
            <div className="release-meta">Date of Approval: {new Date(release.approved_at).toLocaleDateString()}</div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className={`status-pill ${release.overall_status}`}>{release.overall_status}</span>
          {isAdmin && (
            <button className="btn small ghost" disabled={deleting} onClick={handleDelete}>
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          )}
        </div>
      </div>
      {release.note && <div className="release-note">{release.note}</div>}

      <StageLights stages={release.stages} />

      {release.files_available ? (
        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          {release.bin_file_name && (
            <button className="btn" disabled={downloading === 'bin'} onClick={() => download('bin')}>
              {downloading === 'bin' ? 'Fetching…' : `Download ${release.bin_file_name}`}
            </button>
          )}
          {release.zip_file_name && (
            <button className="btn" disabled={downloading === 'zip'} onClick={() => download('zip')}>
              {downloading === 'zip' ? 'Fetching…' : `Download ${release.zip_file_name}`}
            </button>
          )}
          {release.zip2_file_name && (
            <button className="btn" disabled={downloading === 'zip2'} onClick={() => download('zip2')}>
              {downloading === 'zip2' ? 'Fetching…' : `Download ${release.zip2_file_name}`}
            </button>
          )}
          {release.exe_file_name && (
            <button className="btn" disabled={downloading === 'exe'} onClick={() => download('exe')}>
              {downloading === 'exe' ? 'Fetching…' : `Download ${release.exe_file_name}`}
            </button>
          )}
        </div>
      ) : (
        <div className="release-meta" style={{ marginTop: 14 }}>
          {release.overall_status === 'rejected'
            ? 'This build did not pass approval — files are not available.'
            : 'Files unlock once all approval stages pass.'}
        </div>
      )}

      {(isAdmin || release.stages.some((s) => s.can_update)) && (
        <>
          <div className="divider" />
          <div className="section-title" style={{ marginBottom: 8 }}>Approval stages</div>
          <StageEditor release={release} onUpdated={onUpdated} />
        </>
      )}
    </div>
  );
}

export default function ProjectDetail() {
  const { projectId } = useParams();
  const { user } = useAuth();
  const [releases, setReleases] = useState(null);
  const [error, setError] = useState('');
  const [projectName, setProjectName] = useState('');
  const [projectType, setProjectType] = useState('firmware');
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [selectedId, setSelectedId] = useState(null);

  function load() {
    api.listReleases(projectId).then((d) => setReleases(d.releases)).catch((e) => setError(e.message));
    api.listProjects().then((d) => {
      const p = d.projects.find((x) => String(x.id) === String(projectId));
      if (p) {
        setProjectName(p.name);
        setProjectType(p.type || 'firmware');
      }
    });
  }

  useEffect(load, [projectId]);

  const isAdmin = user.role === 'admin';
  const selectedRelease = releases ? releases.find((r) => r.id === selectedId) : null;

  return (
    <div className="main">
      <Link to="/projects" style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>&larr; All projects</Link>
      <h2 style={{ marginTop: 8 }}>{projectName || 'Project'}</h2>

      {error && <div className="error-box">{error}</div>}

      {showUploadForm && (
        <div style={{ marginBottom: 20 }}>
          <UploadForm
            projectId={projectId}
            projectType={projectType}
            onCreated={() => {
              setShowUploadForm(false);
              load();
            }}
            onCancel={() => setShowUploadForm(false)}
          />
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div className="section-title" style={{ margin: 0 }}>Releases</div>
        {isAdmin && !showUploadForm && (
          <button
            className="btn small primary"
            aria-label={`Add new ${projectType === 'app' ? 'build' : 'firmware'}`}
            onClick={() => setShowUploadForm(true)}
            style={{ fontSize: 16, padding: '4px 12px', lineHeight: 1 }}
          >
            +
          </button>
        )}
      </div>

      {!releases && <p className="loading-flicker">Loading releases…</p>}
      {releases && releases.length === 0 && <div className="empty-state">No releases for this project yet.</div>}

      {releases && releases.length > 0 && (
        <div className="panel" style={{ padding: 0, overflow: 'hidden', marginBottom: 14 }}>
          {releases.map((r) => (
            <div
              key={r.id}
              onClick={() => setSelectedId(selectedId === r.id ? null : r.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                padding: '12px 16px',
                borderBottom: '1px solid var(--border)',
                cursor: 'pointer',
                background: selectedId === r.id ? 'var(--pcb-light)' : 'transparent',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, minWidth: 0 }}>
                <span className="mono" style={{ fontWeight: 700, color: 'var(--copper-bright)' }}>{r.version}</span>
                <span className="release-meta">
                  {new Date(r.release_date || r.created_at).toLocaleDateString()}
                </span>
              </div>
              <span className={`status-pill ${r.overall_status}`}>{r.overall_status}</span>
            </div>
          ))}
        </div>
      )}

      {selectedRelease && (
        <ReleaseDetail
          release={selectedRelease}
          isAdmin={isAdmin}
          onUpdated={load}
          onDeleted={() => {
            setSelectedId(null);
            load();
          }}
        />
      )}
    </div>
  );
}
