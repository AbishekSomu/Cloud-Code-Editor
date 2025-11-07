import React, { useState, useEffect, useRef } from "react";
import Editor from "@monaco-editor/react";
import { auth, provider, db } from "./firebase";
import { signInWithPopup } from "firebase/auth";
import {
  collection,
  doc,
  setDoc,
  onSnapshot,
  deleteDoc,
  serverTimestamp,
  getDocs,
} from "firebase/firestore";
import axios from "axios";
import JSZip from "jszip";

/* Starter templates (including plaintext) */
const starterTemplates = {
  javascript: `console.log("Hello World");`,
  python: `print("Hello World")`,
  cpp: `#include <iostream>\nusing namespace std;\n\nint main() {\n    cout << "Hello World" << endl;\n    return 0;\n}`,
  c: `#include <stdio.h>\n\nint main() {\n    printf("Hello World\\n");\n    return 0;\n}`,
  java: `public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello World");\n    }\n}`,
  html: `<!DOCTYPE html>\n<html>\n<head>\n  <meta charset="utf-8" />\n  <title>Hello World</title>\n</head>\n<body>\n  <h1>Hello World</h1>\n</body>\n</html>`,
  plaintext: `This is a new text file.`,
};

export default function App() {
  const [user, setUser] = useState(null);
  const [standaloneFiles, setStandaloneFiles] = useState([]);
  const [projects, setProjects] = useState([]);
  const [expandedProjectId, setExpandedProjectId] = useState(null);
  const [projectFilesMap, setProjectFilesMap] = useState({});
  const [currentFile, setCurrentFile] = useState(null);
  const [code, setCode] = useState("// Start coding...");
  const [output, setOutput] = useState("");
  const [darkMode, setDarkMode] = useState(true);

  const projectListenersRef = useRef({});

  const projectRoot = (uid) => collection(db, "users", uid, "projects");
  const standaloneFilesRoot = (uid) => collection(db, "users", uid, "files");
  const projectFilesRoot = (uid, projectId) => collection(db, "users", uid, "projects", projectId, "files");

  const login = async () => {
    try {
      const result = await signInWithPopup(auth, provider);
      setUser(result.user);
    } catch (err) {
      console.error("Login error:", err);
      alert("Google login failed.");
    }
  };

  useEffect(() => {
    if (!user) return;

    const unsubFiles = onSnapshot(standaloneFilesRoot(user.uid), (snapshot) => {
      const list = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      setStandaloneFiles(list);
    });

    const unsubProjects = onSnapshot(projectRoot(user.uid), (snapshot) => {
      const list = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      setProjects(list);
    });

    return () => {
      unsubFiles();
      unsubProjects();
      Object.values(projectListenersRef.current).forEach((u) => u && u());
      projectListenersRef.current = {};
    };
  }, [user]);

  useEffect(() => {
    if (!user || !expandedProjectId) return;

    if (projectListenersRef.current[expandedProjectId]) return;

    const unsub = onSnapshot(projectFilesRoot(user.uid, expandedProjectId), (snapshot) => {
      const list = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      setProjectFilesMap((prev) => ({ ...prev, [expandedProjectId]: list }));
    });

    projectListenersRef.current[expandedProjectId] = unsub;

    return () => {
      if (projectListenersRef.current[expandedProjectId]) {
        projectListenersRef.current[expandedProjectId]();
        delete projectListenersRef.current[expandedProjectId];
      }
    };
  }, [expandedProjectId, user]);

  const detectLanguage = (name) => {
    const lower = name.toLowerCase();
    if (lower.endsWith(".py")) return "python";
    if (lower.endsWith(".cpp")) return "cpp";
    if (lower.endsWith(".c")) return "c";
    if (lower.endsWith(".java")) return "java";
    if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
    if (lower.endsWith(".txt")) return "plaintext";
    if (lower.endsWith(".js")) return "javascript";
    return "javascript";
  };

  const saveFile = async (newCode) => {
    setCode(newCode);
    if (!currentFile || !user) return;

    try {
      if (currentFile.projectId) {
        await setDoc(doc(db, "users", user.uid, "projects", currentFile.projectId, "files", currentFile.name), {
          name: currentFile.name,
          language: currentFile.language,
          content: newCode,
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(doc(db, "users", user.uid, "files", currentFile.name), {
          name: currentFile.name,
          language: currentFile.language,
          content: newCode,
          updatedAt: serverTimestamp(),
        });
      }
    } catch (err) {
      console.error("Save error:", err);
    }
  };

  const newProject = async () => {
    if (!user) return alert("Please login first.");
    const name = prompt("Enter new project name (no slashes):");
    if (!name) return;
    try {
      await setDoc(doc(db, "users", user.uid, "projects", name), { name, createdAt: serverTimestamp() });
      setExpandedProjectId(name);
    } catch (err) {
      console.error("Create project error:", err);
      alert("Could not create project");
    }
  };

  const newProjectFile = async (projectId) => {
    if (!user) return alert("Please login first.");
    const name = prompt("Enter filename (e.g. main.py or notes.txt):");
    if (!name) return;
    const language = detectLanguage(name);
    const fileData = { name, language, content: starterTemplates[language] || "// New file", updatedAt: serverTimestamp() };
    try {
      await setDoc(doc(db, "users", user.uid, "projects", projectId, "files", name), fileData);
    } catch (err) {
      console.error("Create project file error:", err);
      alert("Could not create file in project");
    }
  };

  const newFile = async () => {
    if (!user) return alert("Please login first.");
    const name = prompt("Enter filename (e.g. script.js or notes.txt):");
    if (!name) return;
    const language = detectLanguage(name);
    const fileData = { name, language, content: starterTemplates[language] || "// New file", updatedAt: serverTimestamp() };
    try {
      await setDoc(doc(db, "users", user.uid, "files", name), fileData);
    } catch (err) {
      console.error("Create file error:", err);
      alert("Could not create file");
    }
  };

  const deleteFile = async (fileName) => {
    if (!user) return;
    if (!window.confirm(`Delete file "${fileName}"?`)) return;
    try {
      await deleteDoc(doc(db, "users", user.uid, "files", fileName));
      if (currentFile?.name === fileName && !currentFile.projectId) {
        setCurrentFile(null);
        setCode("");
        setOutput("");
      }
    } catch (err) {
      console.error("Delete file error:", err);
    }
  };

  const deleteProject = async (projectId) => {
    if (!user) return;
    if (!window.confirm(`Delete project "${projectId}"? This deletes project metadata. Delete project files separately if needed.`)) return;
    try {
      await deleteDoc(doc(db, "users", user.uid, "projects", projectId));
      if (projectListenersRef.current[projectId]) {
        projectListenersRef.current[projectId]();
        delete projectListenersRef.current[projectId];
      }
      setProjectFilesMap((prev) => {
        const copy = { ...prev };
        delete copy[projectId];
        return copy;
      });
      if (expandedProjectId === projectId) setExpandedProjectId(null);
    } catch (err) {
      console.error("Delete project error:", err);
    }
  };

  const deleteProjectFile = async (projectId, fileName) => {
    if (!user) return;
    if (!window.confirm(`Delete file "${fileName}" from project "${projectId}"?`)) return;
    try {
      await deleteDoc(doc(db, "users", user.uid, "projects", projectId, "files", fileName));
      if (currentFile?.name === fileName && currentFile?.projectId === projectId) {
        setCurrentFile(null);
        setCode("");
        setOutput("");
      }
    } catch (err) {
      console.error("Delete project file error:", err);
    }
  };

  const downloadFile = (file) => {
    try {
      const content = file.content || "";
      const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = file.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error("Download error:", err);
      alert("Could not download file");
    }
  };

  // New: download entire project as zip
  const downloadProjectAsZip = async (projectId) => {
    if (!user) return;
    try {
      // if files are already loaded for this project use them, otherwise fetch
      let files = projectFilesMap[projectId];
      if (!files || files.length === 0) {
        // fetch from Firestore
        const snap = await getDocs(projectFilesRoot(user.uid, projectId));
        files = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      }
      const zip = new JSZip();
      if (!files || files.length === 0) {
        // create README if empty
        zip.file(`${projectId}/README.txt`, `Project ${projectId} is empty.`);
      } else {
        files.forEach((f) => {
          const path = `${projectId}/${f.name}`;
          zip.file(path, f.content ?? "");
        });
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${projectId}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Download project ZIP error:", err);
      alert("Could not download project as zip");
    }
  };

  const runCode = async () => {
    if (!currentFile) {
      setOutput("No file selected");
      return;
    }

    const language = currentFile.language;

    if (language === "javascript") {
      try {
        let logs = [];
        const originalLog = console.log;
        console.log = (...args) => {
          logs.push(args.join(" "));
          originalLog(...args);
        };
        const result = eval(code);
        console.log = originalLog;
        if (logs.length > 0) setOutput(logs.join("\n"));
        else if (result !== undefined) setOutput(String(result));
        else setOutput("No output");
      } catch (err) {
        setOutput("Error: " + err.message);
      }
    } else if (language === "html") {
      setOutput("");
      const iframe = document.createElement("iframe");
      iframe.style.width = "100%";
      iframe.style.height = "300px";
      iframe.style.border = "1px solid #666";
      const container = document.getElementById("html-output");
      container.innerHTML = "";
      container.appendChild(iframe);
      iframe.contentDocument.open();
      iframe.contentDocument.write(code);
      iframe.contentDocument.close();
    } else {
      try {
        setOutput("⏳ Running your " + language + " code...");
        const languageMap = { python: 71, cpp: 54, c: 50, java: 62 };
        const response = await axios.post(
          "https://judge0-ce.p.rapidapi.com/submissions?base64_encoded=false&wait=true",
          { source_code: code, language_id: languageMap[language] },
          {
            headers: {
              "Content-Type": "application/json",
              "X-RapidAPI-Host": "judge0-ce.p.rapidapi.com",
              "X-RapidAPI-Key": "5bde09d0d1msh7bfb1e83d15744fp19d68djsn96274c6c0e0b",
            },
          }
        );
        const result = response.data;
        if (result.stderr) setOutput("❌ Runtime Error:\n" + result.stderr);
        else if (result.compile_output) setOutput("⚠️ Compilation Error:\n" + result.compile_output);
        else if (result.stdout) setOutput(result.stdout.trim());
        else setOutput("✅ Finished with no output");
      } catch (err) {
        setOutput("API Error: " + err.message);
      }
    }
  };

  const openStandaloneFile = (f) => {
    setCurrentFile({ ...f, projectId: null });
    setCode(f.content || "");
  };

  const openProjectFile = (projectId, f) => {
    setCurrentFile({ ...f, projectId });
    setCode(f.content || "");
  };

  return (
    <div className={darkMode ? "app dark" : "app light"}>
      {!user ? (
        <div className="login-container">
          <div className="login-box">
            <h1>Cloud Code Editor</h1>
            <button className="google-login" onClick={login}>
              Login with Google
            </button>

            <div className="theme-toggle">
              <label className="switch">
                <input type="checkbox" checked={darkMode} onChange={() => setDarkMode(!darkMode)} />
                <span className="slider">{darkMode ? "🌙" : "☀️"}</span>
              </label>
            </div>

            <p style={{ marginTop: 18, fontSize: 14 }}>Sign in to create projects and files</p>
          </div>
        </div>
      ) : (
        <div className="main-container">
          <div className="sidebar">
            <h4>Your Workspace</h4>
            <button onClick={newProject}>+ New Project</button>
            <button onClick={newFile}>+ New File</button>

            <div className="projects-section">
              <strong style={{ display: "block", marginTop: 12 }}>Projects</strong>
              <div className="projects-grid">
                {projects.length === 0 && <div className="no-projects">No projects yet</div>}
                {projects.map((project) => {
                  const files = projectFilesMap[project.id] || [];
                  const hasFiles = files.length > 0;
                  return (
                    <div key={project.id} className="project-card">
                      <div className="project-folder" onClick={() => setExpandedProjectId((p) => (p === project.id ? null : project.id))}>
                        <div className="folder-icon">📁</div>
                        <div className="project-name">{project.name}</div>
                      </div>

                      <div className="project-actions">
                        <button onClick={() => downloadProjectAsZip(project.id)} title="Download project as ZIP">⬇️</button>
                        <button onClick={() => deleteProject(project.id)} title="Delete project">🗑</button>
                        <button onClick={() => newProjectFile(project.id)} title="Add file">+ Add File</button>
                      </div>

                      {expandedProjectId === project.id && (
                        <div className="project-files">
                          {!hasFiles && <div className="no-files">No files</div>}
                          {hasFiles &&
                            files.map((f) => (
                              <div key={f.id} className="file-item">
                                <span className="file-name" onClick={() => openProjectFile(project.id, f)}>📄 {f.name}</span>
                                <div className="file-buttons">
                                  <button onClick={() => downloadFile(f)} title="Download file">⬇️</button>
                                  <button onClick={() => deleteProjectFile(project.id, f.name)} title="Delete file">❌</button>
                                </div>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{ marginTop: 14 }}>
              <strong>Standalone Files</strong>
              <ul>
                {standaloneFiles.length === 0 && <li style={{ opacity: 0.6 }}>No files</li>}
                {standaloneFiles.map((f) => (
                  <li key={f.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ cursor: "pointer" }} onClick={() => openStandaloneFile(f)}>
                      📄 {f.name}
                    </span>
                    <button onClick={() => downloadFile(f)}>⬇️</button>
                    <button onClick={() => deleteFile(f.name)}>❌</button>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="editor-container">
            <div className="top-bar">
              <button onClick={() => setDarkMode(!darkMode)}>{darkMode ? "Light Mode" : "Dark Mode"}</button>
            </div>

            {currentFile ? (
              <>
                <div className="editor-header">
                  <h3>
                    Editing: {currentFile.name} {currentFile.projectId ? ` (project: ${currentFile.projectId})` : ""}
                  </h3>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={runCode}
                      disabled={currentFile?.language === "plaintext"}
                      title={currentFile?.language === "plaintext" ? "Cannot run text files" : "Run code"}
                    >
                      Run Code
                    </button>
                    <button onClick={() => downloadFile(currentFile)}>Download</button>
                  </div>
                </div>

                <Editor
                  height="70vh"
                  language={currentFile.language === "plaintext" ? "text" : currentFile.language}
                  value={code}
                  onChange={(val) => saveFile(val ?? "")}
                  theme={darkMode ? "vs-dark" : "light"}
                  options={{
                    quickSuggestions: true,             // basic completions
                    suggestOnTriggerCharacters: true,   // show suggestions when typing .
                    wordBasedSuggestions: true,         // complete from nearby words
                    tabCompletion: "on",
                    minimap: { enabled: false },
                    fontSize: 14,
                  }}
                />


                <div className="output-box">
                  <h4>Output:</h4>
                  {currentFile.language === "html" ? <div id="html-output" /> : <pre>{output}</pre>}
                </div>
              </>
            ) : (
              <p className="select-file-text">Select a file to start editing</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
