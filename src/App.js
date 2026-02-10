import React, { useState, useEffect, useRef } from "react";
import Editor from "@monaco-editor/react";
import { auth, provider, db } from "./firebase";
import { signInWithPopup, onAuthStateChanged, signOut } from "firebase/auth";
import {
  collection,
  addDoc,
  collectionGroup,
  query,
  orderBy,
  limit,
  where,
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
  csharp: `using System;

public class Program {
    public static void Main() {
        Console.WriteLine("Hello World");
    }
}`,
  css: `/* CSS file */\nbody {\n  font-family: sans-serif;\n}\n`,
  html: `<!DOCTYPE html>\n<html>\n<head>\n  <meta charset="utf-8" />\n  <title>Hello World</title>\n</head>\n<body>\n  <h1>Hello World</h1>\n</body>\n</html>`,
  plaintext: `This is a new text file.`,
};

const IconButton = ({ title, onClick, children, className = "", disabled = false }) => (
  <button className={`icon-btn ${className}`.trim()} onClick={onClick} title={title} disabled={disabled}>
    {children}
  </button>
);

const ActionButton = ({ onClick, children, title }) => (
  <button className="action-btn" onClick={onClick} title={title}>
    {children}
  </button>
);

const ThemeToggleButton = ({ darkMode, onToggle, compact = false }) => (
  <button
    className={`theme-pill ${darkMode ? "is-dark" : "is-light"} ${compact ? "compact" : ""}`.trim()}
    onClick={onToggle}
    title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
  >
    <span className="theme-icon">{darkMode ? "\u{1F319}" : "\u2600\uFE0F"}</span>
    <span className="theme-label">{darkMode ? "Dark" : "Light"}</span>
    <span className="theme-dot" />
  </button>
);

export default function App() {
  const [user, setUser] = useState(null);
  const [standaloneFiles, setStandaloneFiles] = useState([]);
  const [projects, setProjects] = useState([]);
  const [expandedProjectId, setExpandedProjectId] = useState(null);
  const [projectFilesMap, setProjectFilesMap] = useState({});
  const [currentFile, setCurrentFile] = useState(null);
  const [code, setCode] = useState("// Start coding...");
  const [output, setOutput] = useState("");
  const [consoleOutput, setConsoleOutput] = useState("");
  const [outputTab, setOutputTab] = useState("output");
  const [savedAt, setSavedAt] = useState(null);
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return true;
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });
  const [presenceUsers, setPresenceUsers] = useState([]);
  const presenceUsersRef = useRef([]);
  const [outputHeight, setOutputHeight] = useState(180);
  const isResizingRef = useRef(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatText, setChatText] = useState("");
  const [showChat, setShowChat] = useState(false);
  
  const [globalUnreadCount, setGlobalUnreadCount] = useState(0);
  const [typingUsers, setTypingUsers] = useState([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const projectListenersRef = useRef({});
  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const decorationsRef = useRef([]);
  const latestSelectionRef = useRef(null);
  const presenceWriteTimerRef = useRef(null);
  const editorContainerRef = useRef(null);
  const typingTimerRef = useRef(null);

  const projectRoot = (uid) => collection(db, "users", uid, "projects");
  const standaloneFilesRoot = (uid) => collection(db, "users", uid, "files");
  const projectFilesRoot = (uid, projectId) => collection(db, "users", uid, "projects", projectId, "files");
  const presenceRoot = (fileKey) => collection(db, "presence", fileKey, "users");
  const chatRoot = (fileKey) => collection(db, "chat", fileKey, "messages");
  const typingRoot = (fileKey) => collection(db, "chat", fileKey, "typing");
  const fileKeyFor = (file) => {
    const ownerId = file.ownerId || user?.uid || "unknown";
    return file.projectId
      ? `project:${ownerId}:${file.projectId}:${file.name}`
      : `standalone:${ownerId}:${file.name}`;
  };
  const safeId = (name) => encodeURIComponent(name);
  const fileIcon = () => "\u{1F4C4}";

  const getLocalDateKey = () => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  };

  const login = async () => {
    try {
      const result = await signInWithPopup(auth, provider);
      setUser(result.user);
      try {
        localStorage.setItem("authLoginDate", getLocalDateKey());
      } catch {
        // ignore storage errors
      }
    } catch (err) {
      console.error("Login error:", err);
      alert("Google login failed.");
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
      setUser(null);
    } catch (err) {
      console.error("Logout error:", err);
      alert("Could not logout");
    }
  };

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (u) => {
      if (!u) {
        setUser(null);
        return;
      }
      let storedDate = "";
      try {
        storedDate = localStorage.getItem("authLoginDate") || "";
      } catch {
        storedDate = "";
      }
      const today = getLocalDateKey();
      if (storedDate && storedDate !== today) {
        signOut(auth).finally(() => {
          try {
            localStorage.removeItem("authLoginDate");
          } catch {
            // ignore storage errors
          }
          setUser(null);
        });
        return;
      }
      setUser(u);
    });
    return () => unsubAuth();
  }, []);


  useEffect(() => {
    if (!user) return;

    const unsubProjects = onSnapshot(collectionGroup(db, "projects"), (snapshot) => {
      const list = snapshot.docs.map((d) => {
        const data = d.data();
        const pathParts = d.ref.path.split("/");
        const ownerId = data.ownerId || pathParts[1];
        const isPublic = data.isPublic !== false;
        return { id: d.id, ownerId, isPublic, ...data };
      }).filter((p) => p.isPublic || p.ownerId === user.uid);
      setProjects(list);
    });

    const unsubFiles = onSnapshot(collectionGroup(db, "files"), (snapshot) => {
      const list = snapshot.docs.map((d) => {
        const data = d.data();
        const pathParts = d.ref.path.split("/");
        const ownerId = data.ownerId || pathParts[1];
        const isPublic = data.isPublic !== false;
        const isProjectFile = d.ref.path.includes("/projects/");
        const parentType = data.parentType || (isProjectFile ? "project" : "standalone");
        return { id: d.id, ownerId, isPublic, parentType, ...data };
      }).filter((f) => f.parentType === "standalone" && (f.isPublic || f.ownerId === user.uid));
      setStandaloneFiles(list);
    });

    return () => {
      unsubFiles();
      unsubProjects();
      Object.values(projectListenersRef.current).forEach((u) => u && u());
      projectListenersRef.current = {};
    };
  }, [user]);

  useEffect(() => {
    const onMove = (e) => {
      if (!isResizingRef.current || !editorContainerRef.current) return;
      const rect = editorContainerRef.current.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const minOutput = 120;
      const maxOutput = Math.max(minOutput, rect.height - 220);
      const next = Math.min(Math.max(rect.height - y, minOutput), maxOutput);
      setOutputHeight(Math.round(next));
    };
    const onUp = () => {
      isResizingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  useEffect(() => {
    if (!user || !currentFile) {
      setPresenceUsers([]);
      return;
    }

    const fileKey = fileKeyFor(currentFile);
    const presenceDoc = doc(db, "presence", fileKey, "users", user.uid);
    const presenceRef = presenceRoot(fileKey);
    let heartbeatId;

    const writePresence = () =>
      setDoc(
        presenceDoc,
        {
          uid: user.uid,
          displayName: user.displayName || "Anonymous",
          photoURL: user.photoURL || "",
          fileName: currentFile.name,
          projectId: currentFile.projectId || null,
          selection: latestSelectionRef.current || null,
          lastActive: serverTimestamp(),
        },
        { merge: true }
      );

    writePresence();
    heartbeatId = setInterval(writePresence, 30000);

    const sameViewerList = (a, b) => {
      if (a.length !== b.length) return false;
      const mapA = new Map(a.map((u) => [u.uid, u]));
      for (const u of b) {
        const prev = mapA.get(u.uid);
        if (!prev) return false;
        if (prev.displayName !== u.displayName) return false;
        if (prev.photoURL !== u.photoURL) return false;
      }
      return true;
    };

    const unsub = onSnapshot(presenceRef, (snapshot) => {
      const now = Date.now();
      const list = snapshot.docs
        .map((d) => d.data())
        .filter((u) => {
          const ts = u.lastActive?.toMillis ? u.lastActive.toMillis() : 0;
          return now - ts < 30000;
        })
        .sort((a, b) => (a.uid || "").localeCompare(b.uid || ""));
      const prev = presenceUsersRef.current;
      if (!sameViewerList(prev, list)) {
        presenceUsersRef.current = list;
        setPresenceUsers(list);
      }
    });

    return () => {
      if (heartbeatId) clearInterval(heartbeatId);
      unsub();
      deleteDoc(presenceDoc).catch(() => {});
    };
  }, [user, currentFile]);

  useEffect(() => {
    if (!user || !currentFile) {
      setChatMessages([]);
      // local unread is no longer used; global badge handles it
      return;
    }
    const fileKey = fileKeyFor(currentFile);
    const q = query(chatRoot(fileKey), orderBy("createdAt", "asc"), limit(100));
    const unsub = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      setChatMessages(list);
    });
    return () => unsub();
  }, [user, currentFile]);

  useEffect(() => {
    if (!user || !currentFile) {
      setTypingUsers([]);
      return;
    }
    const fileKey = fileKeyFor(currentFile);
    const unsub = onSnapshot(typingRoot(fileKey), (snapshot) => {
      const now = Date.now();
      const list = snapshot.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((u) => u.uid !== user.uid)
        .filter((u) => {
          const ts = u.typingAt?.toMillis ? u.typingAt.toMillis() : 0;
          return u.isTyping && now - ts < 5000;
        })
        .map((u) => u.displayName || "Anonymous");
      setTypingUsers(list);
    });
    return () => unsub();
  }, [user, currentFile]);

  useEffect(() => {
    if (!user) {
      setGlobalUnreadCount(0);
      return;
    }
    const q = query(collectionGroup(db, "messages"), orderBy("createdAt", "desc"), limit(200));
    const unsub = onSnapshot(q, (snapshot) => {
      let count = 0;
      snapshot.docs.forEach((d) => {
        const data = d.data();
        if (data.uid === user.uid) return;
        const fileKey = d.ref.parent.parent?.id;
        if (!fileKey) return;
        const storageKey = `chatLastSeen:${fileKey}:${user.uid}`;
        let lastSeen = 0;
        try {
          lastSeen = Number(localStorage.getItem(storageKey) || "0");
        } catch {
          lastSeen = 0;
        }
        const ts = data.createdAt?.toMillis ? data.createdAt.toMillis() : 0;
        if (ts > lastSeen) count += 1;
      });
      setGlobalUnreadCount(count);
    });
    return () => unsub();
  }, [user]);

  useEffect(() => {
    // local unread is no longer used; global badge handles it
  }, [chatMessages, showChat, user, currentFile]);

  const sendChat = async () => {
    if (!user || !currentFile) return;
    const text = chatText.trim();
    if (!text) return;
    try {
      const fileKey = fileKeyFor(currentFile);
      await addDoc(chatRoot(fileKey), {
        uid: user.uid,
        displayName: user.displayName || "Anonymous",
        photoURL: user.photoURL || "",
        text,
        createdAt: serverTimestamp(),
      });
      setChatText("");
      setTyping(false);
    } catch (err) {
      console.error("Chat send error:", err);
      alert("Could not send message");
    }
  };

  const setTyping = async (isTyping) => {
    if (!user || !currentFile) return;
    try {
      const fileKey = fileKeyFor(currentFile);
      await setDoc(
        doc(db, "chat", fileKey, "typing", user.uid),
        {
          uid: user.uid,
          displayName: user.displayName || "Anonymous",
          isTyping,
          typingAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch {
      // ignore typing errors
    }
  };

  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;

    const others = presenceUsers.filter((u) => u.uid !== user?.uid);
    const colors = ["0", "1", "2", "3", "4", "5"];

    const colorFor = (uid) => {
      let hash = 0;
      for (let i = 0; i < uid.length; i += 1) hash = (hash * 31 + uid.charCodeAt(i)) | 0;
      const idx = Math.abs(hash) % colors.length;
      return colors[idx];
    };

    const decos = [];
    for (const u of others) {
      if (!u.selection) continue;
      const c = colorFor(u.uid || "");
      const s = u.selection;
      const startLine = Math.max(1, s.startLineNumber || 1);
      const startCol = Math.max(1, s.startColumn || 1);
      const endLine = Math.max(1, s.endLineNumber || startLine);
      const endCol = Math.max(1, s.endColumn || startCol);

      decos.push({
        range: new monaco.Range(startLine, 1, startLine, 1),
        options: { isWholeLine: true, className: `presence-line presence-line-${c}` },
      });

      if (startLine !== endLine || startCol !== endCol) {
        decos.push({
          range: new monaco.Range(startLine, startCol, endLine, endCol),
          options: { className: `presence-selection presence-selection-${c}` },
        });
      }
    }

    decorationsRef.current = editor.deltaDecorations(decorationsRef.current, decos);
  }, [presenceUsers, user?.uid]);

  useEffect(() => {
    if (!user || !expandedProjectId) return;

    if (projectListenersRef.current[expandedProjectId]) return;

    const project = projects.find((p) => p.id === expandedProjectId);
    const ownerId = project?.ownerId;
    const q = ownerId
      ? query(collectionGroup(db, "files"), where("projectId", "==", expandedProjectId), where("ownerId", "==", ownerId))
      : query(collectionGroup(db, "files"), where("projectId", "==", expandedProjectId));
    const unsub = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map((d) => {
        const data = d.data();
        const pathParts = d.ref.path.split("/");
        const ownerId = data.ownerId || pathParts[1];
        const isPublic = data.isPublic !== false;
        return { id: d.id, ownerId, isPublic, ...data };
      }).filter((f) => f.isPublic || f.ownerId === user.uid);
      setProjectFilesMap((prev) => ({ ...prev, [expandedProjectId]: list }));
    });

    projectListenersRef.current[expandedProjectId] = unsub;

    return () => {
      if (projectListenersRef.current[expandedProjectId]) {
        projectListenersRef.current[expandedProjectId]();
        delete projectListenersRef.current[expandedProjectId];
      }
    };
  }, [expandedProjectId, user, projects]);

  const detectLanguage = (name) => {
    const lower = name.toLowerCase();
    if (lower.endsWith(".py")) return "python";
    if (lower.endsWith(".cpp")) return "cpp";
    if (lower.endsWith(".c")) return "c";
    if (lower.endsWith(".java")) return "java";
    if (lower.endsWith(".cs")) return "csharp";
    if (lower.endsWith(".css")) return "css";
    if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
    if (lower.endsWith(".txt")) return "plaintext";
    if (lower.endsWith(".js")) return "javascript";
    return "javascript";
  };

  const saveFile = async (newCode) => {
    setCode(newCode);
    if (!currentFile || !user) return;

    try {
      const fileId = currentFile.id || safeId(currentFile.name);
      const isPublic = currentFile.isPublic !== false;
      const ownerId = currentFile.ownerId || user.uid;
      if (currentFile.projectId) {
        await setDoc(doc(db, "users", ownerId, "projects", currentFile.projectId, "files", fileId), {
          name: currentFile.name,
          language: currentFile.language,
          content: newCode,
          ownerId,
          isPublic,
          projectId: currentFile.projectId,
          parentType: "project",
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(doc(db, "users", ownerId, "files", fileId), {
          name: currentFile.name,
          language: currentFile.language,
          content: newCode,
          ownerId,
          isPublic,
          parentType: "standalone",
          updatedAt: serverTimestamp(),
        });
      }
      setSavedAt(Date.now());
    } catch (err) {
      console.error("Save error:", err);
    }
  };

  const newProject = async () => {
    if (!user) return alert("Please login first.");
    const name = prompt("Enter new project name (no slashes):");
    if (!name) return;
    try {
      await setDoc(doc(db, "users", user.uid, "projects", name), {
        name,
        ownerId: user.uid,
        isPublic: true,
        createdAt: serverTimestamp(),
      });
      setExpandedProjectId(name);
    } catch (err) {
      console.error("Create project error:", err);
      alert("Could not create project");
    }
  };

  const newProjectFile = async (projectId) => {
    if (!user) return alert("Please login first.");
    const name = prompt("Enter filename (e.g. main.py or notes.txt). You can include folders like css/style.css:");
    if (!name) return;
    const language = detectLanguage(name);
    const fileData = {
      name,
      language,
      content: starterTemplates[language] || "// New file",
      ownerId: user.uid,
      isPublic: true,
      projectId,
      parentType: "project",
      updatedAt: serverTimestamp(),
    };
    try {
      await setDoc(doc(db, "users", user.uid, "projects", projectId, "files", safeId(name)), fileData);
    } catch (err) {
      console.error("Create project file error:", err);
      alert("Could not create file in project");
    }
  };

  const newFile = async () => {
    if (!user) return alert("Please login first.");
    const name = prompt("Enter filename (e.g. script.js or notes.txt). You can include folders like css/style.css:");
    if (!name) return;
    const language = detectLanguage(name);
    const fileData = {
      name,
      language,
      content: starterTemplates[language] || "// New file",
      ownerId: user.uid,
      isPublic: true,
      parentType: "standalone",
      updatedAt: serverTimestamp(),
    };
    try {
      await setDoc(doc(db, "users", user.uid, "files", safeId(name)), fileData);
    } catch (err) {
      console.error("Create file error:", err);
      alert("Could not create file");
    }
  };

  const deleteFile = async (file) => {
    if (!user) return;
    if (!window.confirm(`Delete file "${file.name}"?`)) return;
    try {
      const fileId = file.id || safeId(file.name);
      const ownerId = file.ownerId || user.uid;
      await deleteDoc(doc(db, "users", ownerId, "files", fileId));
      if (currentFile?.name === file.name && !currentFile.projectId) {
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

  if (!window.confirm(`Delete project "${projectId}" and ALL its files?`)) return;

  try {
    const filesRef = collection(
      db,
      "users",
      user.uid,
      "projects",
      projectId,
      "files"
    );
    // 1) Get all files inside the project
    const filesSnap = await getDocs(filesRef);
    // 2) Delete each file
    const deletions = filesSnap.docs.map((f) =>
      deleteDoc(doc(db, "users", user.uid, "projects", projectId, "files", f.id))
    );

    await Promise.all(deletions);
    // 3) Delete the project document itself
    await deleteDoc(doc(db, "users", user.uid, "projects", projectId));
    // 4) Cleanup UI state
    if (expandedProjectId === projectId) setExpandedProjectId(null);
    setProjectFilesMap((prev) => {
      const copy = { ...prev };
      delete copy[projectId];
      return copy;
    });

    console.log("Project and files deleted completely");
  } catch (err) {
    console.error("Full project delete error:", err);
    alert("Failed to delete project completely");
  }
};
  const deleteProjectFile = async (projectId, file) => {
    if (!user) return;
    if (!window.confirm(`Delete file "${file.name}" from project "${projectId}"?`)) return;
    try {
      const fileId = file.id || safeId(file.name);
      const ownerId = file.ownerId || user.uid;
      await deleteDoc(doc(db, "users", ownerId, "projects", projectId, "files", fileId));
      if (currentFile?.name === file.name && currentFile?.projectId === projectId) {
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
        // eslint-disable-next-line no-eval
        const result = eval(code);
        console.log = originalLog;
        if (logs.length > 0) setConsoleOutput(logs.join("\n"));
        else setConsoleOutput("");
        if (result !== undefined) setOutput(String(result));
        else setOutput("No output");
      } catch (err) {
        setConsoleOutput("");
        setOutput("Error: " + err.message);
      }
    } else if (language === "html") {
      setOutput("");
      setConsoleOutput("");
      const getFileByName = async (name) => {
        if (currentFile.projectId) {
          const cached = projectFilesMap[currentFile.projectId] || [];
          let found = cached.find((f) => f.name === name);
          if (!found) {
            const snap = await getDocs(projectFilesRoot(user.uid, currentFile.projectId));
            const files = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
            found = files.find((f) => f.name === name);
          }
          if (found) return found;
          const baseName = name.split("/").pop();
          return cached.find((f) => f.name === baseName) || null;
        }
        const direct = standaloneFiles.find((f) => f.name === name);
        if (direct) return direct;
        const baseName = name.split("/").pop();
        return standaloneFiles.find((f) => f.name === baseName) || null;
      };

      const linkTagRegex = /<link[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi;
      let html = code;
      let match;
      const styles = [];
      while ((match = linkTagRegex.exec(code)) !== null) {
        const href = match[1];
        const cssFile = await getFileByName(href);
        if (cssFile?.content) {
          styles.push(`/* ${href} */\n${cssFile.content}`);
          html = html.replace(match[0], "");
        }
      }
      if (styles.length > 0) {
        const styleBlock = `<style>\n${styles.join("\n\n")}\n</style>`;
        if (html.includes("</head>")) html = html.replace("</head>", `${styleBlock}\n</head>`);
        else html = `${styleBlock}\n${html}`;
      }

      const iframe = document.createElement("iframe");
      iframe.style.width = "100%";
      iframe.style.height = "300px";
      iframe.style.border = "1px solid #666";
      const container = document.getElementById("html-output");
      container.innerHTML = "";
      container.appendChild(iframe);
      iframe.contentDocument.open();
      iframe.contentDocument.write(html);
      iframe.contentDocument.close();
    } else if (language === "css") {
      setOutput("CSS preview is not supported yet. Create an HTML file to preview CSS.");
      setConsoleOutput("");
    } else {
      try {
        setConsoleOutput("");
        const apiKey = process.env.REACT_APP_RAPIDAPI_KEY;
        if (!apiKey) {
          setOutput("Missing RapidAPI key. Set REACT_APP_RAPIDAPI_KEY in .env and restart the dev server.");
          return;
        }
        const apiHost = process.env.REACT_APP_RAPIDAPI_HOST;
        if (!apiHost) {
          setOutput("Missing RapidAPI host. Set REACT_APP_RAPIDAPI_HOST in .env and restart the dev server.");
          return;
        }
        setOutput("\u23F3 Running your " + language + " code...");
        const languageMap = { python: 71, cpp: 54, c: 50, java: 62, csharp: 51 };
        if (!languageMap[language]) {
          setOutput("This language is not supported for execution.");
          return;
        }
        const apiUrl = `https://${apiHost}/submissions?base64_encoded=false&wait=true`;
        const response = await axios.post(
          apiUrl,
          { source_code: code, language_id: languageMap[language] },
          {
            headers: {
              "Content-Type": "application/json",
              "X-RapidAPI-Host": apiHost,
              "X-RapidAPI-Key": apiKey,
            },
          }
        );
        const result = response.data;
        if (result.stderr) setOutput("\u274C Runtime Error:\\n" + result.stderr);
        else if (result.compile_output) setOutput("\u26A0\uFE0F Compilation Error:\\n" + result.compile_output);
        else if (result.stdout) setOutput(result.stdout.trim());
        else setOutput("\u2705 Finished with no output");
      } catch (err) {
        const status = err?.response?.status;
        if (status === 401 || status === 403) {
          setOutput("Invalid RapidAPI key. Check REACT_APP_RAPIDAPI_KEY.");
          return;
        }
        if (status === 429) {
          setOutput("RapidAPI rate limit hit. Please try again later.");
          return;
        }
        setOutput("API Error: " + (err?.response?.data?.message || err.message));
      }
    }
  };

  const openStandaloneFile = (f) => {
    setCurrentFile({ ...f, projectId: null, ownerId: f.ownerId || user?.uid });
    setCode(f.content || "");
    setSavedAt(null);
  };

  const openProjectFile = (projectId, f) => {
    setCurrentFile({ ...f, projectId, ownerId: f.ownerId || user?.uid });
    setCode(f.content || "");
    setSavedAt(null);
  };

  return (
    <div className={darkMode ? "app dark" : "app light"}>
      {!user ? (
        <div className="login-container">
          <div className="login-theme-toggle">
            <ThemeToggleButton darkMode={darkMode} onToggle={() => setDarkMode(!darkMode)} />
          </div>
          <div className="login-card">
            <div className="login-left">
              <div className="brand-mark">⟡</div>
              <h1>Cloud Code Editor</h1>
              <p className="login-subtitle">Write, run, and collaborate in real time.</p>
              <ul className="login-features">
                <li>Multi-language editor with live preview</li>
                <li>Project workspace with downloads</li>
                <li>Presence and chat built-in</li>
              </ul>
            </div>
            <div className="login-right">
              <div className="login-panel">
                <h2>Welcome back</h2>
                <p className="login-note">Sign in to sync your projects and files.</p>
                <button className="google-login" onClick={login}>
                  Continue with Google
                </button>
                <div className="login-hint">No account? Google sign‑in creates one instantly.</div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="main-container">
          <div className={`sidebar ${sidebarOpen ? "open" : ""}`}>
            <h4>Your Workspace</h4>
            <ActionButton onClick={newProject} title="Create a new project">+ New Project</ActionButton>
            <ActionButton onClick={newFile} title="Create a new file">+ New File</ActionButton>
            <div className="sidebar-search">
              <input
                type="text"
                placeholder="Search files or projects..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <span className="hint">⌘K</span>
            </div>

            <div className="sidebar-scroll">
              <div className="projects-section">
                <strong style={{ display: "block", marginTop: 12 }}>Projects</strong>
                <div className="projects-grid">
                  {projects.filter((p) => p.name?.toLowerCase().includes(searchQuery.toLowerCase())).length === 0 && (
                    <div className="empty-card">
                      <div className="empty-hint">Create a new project to organize your files.</div>
                    </div>
                  )}
                  {projects
                    .filter((p) => p.name?.toLowerCase().includes(searchQuery.toLowerCase()))
                    .map((project) => {
                    const files = projectFilesMap[project.id] || [];
                    const hasFiles = files.length > 0;
                    const isOwner = project.ownerId === user.uid;
                    return (
                      <div key={project.id} className="project-card">
                        <div className="project-folder" onClick={() => setExpandedProjectId((p) => (p === project.id ? null : project.id))}>
                          <div className="folder-icon">{"\u{1F4C1}"}</div>
                          <div className="project-name">
                            {project.name}
                            {isOwner && (
                              <button
                                className="lock-toggle"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const next = project.isPublic === false;
                                  const ownerId = project.ownerId || user.uid;
                                  setDoc(doc(db, "users", ownerId, "projects", project.id), { isPublic: next }, { merge: true });
                                }}
                                title={project.isPublic === false ? "Private (locked)" : "Public"}
                              >
                                {project.isPublic === false ? "\u{1F512}" : "\u{1F513}"}
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="project-actions">
                          <IconButton
                            onClick={() => downloadProjectAsZip(project.id)}
                            title="Download project as ZIP"
                            className="primary"
                          >
                            {"\u2B07\uFE0F"}
                          </IconButton>
                          {isOwner && (
                            <IconButton
                              onClick={() => deleteProject(project.id)}
                              title="Delete project"
                              className="danger"
                            >
                              {"\u{1F5D1}"}
                            </IconButton>
                          )}
                          {isOwner && <button onClick={() => newProjectFile(project.id)} title="Add file">+ Add File</button>}
                        </div>

                        {expandedProjectId === project.id && (
                          <div className="project-files">
                            {!hasFiles && <div className="no-files">No files</div>}
                            {hasFiles &&
                              files.map((f) => (
                                <div key={f.id} className="file-item">
                                <div className="file-meta">
                                  <div className="file-meta-row">
                                    <span className="file-name" onClick={() => openProjectFile(project.id, f)}>
                                      {fileIcon()} {f.name}
                                    </span>
                                    {f.ownerId === user.uid && (
                                      <button
                                        className="lock-toggle"
                                        onClick={() => {
                                          const next = f.isPublic === false;
                                          const ownerId = f.ownerId || user.uid;
                                          setDoc(
                                            doc(db, "users", ownerId, "projects", project.id, "files", f.id || safeId(f.name)),
                                            { isPublic: next },
                                            { merge: true }
                                          );
                                        }}
                                        title={f.isPublic === false ? "Private (locked)" : "Public"}
                                      >
                                        {f.isPublic === false ? "\u{1F512}" : "\u{1F513}"}
                                      </button>
                                    )}
                                  </div>
                                </div>
                                  <div className="file-buttons">
                                    <IconButton onClick={() => downloadFile(f)} title="Download file" className="primary">
                                      {"\u2B07\uFE0F"}
                                    </IconButton>
                                    {f.ownerId === user.uid && (
                                      <IconButton onClick={() => deleteProjectFile(project.id, f)} title="Delete file" className="danger">
                                        {"\u274C"}
                                      </IconButton>
                                    )}
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
                  {standaloneFiles.filter((f) => f.name?.toLowerCase().includes(searchQuery.toLowerCase())).length === 0 && (
                    <li>
                      <div className="empty-card">
                        <div className="empty-title">No files found</div>
                        <div className="empty-hint">Create a file or clear your search.</div>
                      </div>
                    </li>
                  )}
                  {standaloneFiles
                    .filter((f) => f.name?.toLowerCase().includes(searchQuery.toLowerCase()))
                    .map((f) => (
                    <li key={f.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div className="file-meta">
                      <div className="file-meta-row">
                        <span style={{ cursor: "pointer" }} onClick={() => openStandaloneFile(f)}>
                          {fileIcon()} {f.name}
                        </span>
                        {f.ownerId === user.uid && (
                          <button
                            className="lock-toggle"
                            onClick={() => {
                              const next = f.isPublic === false;
                              const ownerId = f.ownerId || user.uid;
                              setDoc(
                                doc(db, "users", ownerId, "files", f.id || safeId(f.name)),
                                { isPublic: next },
                                { merge: true }
                              );
                            }}
                            title={f.isPublic === false ? "Private (locked)" : "Public"}
                          >
                            {f.isPublic === false ? "\u{1F512}" : "\u{1F513}"}
                          </button>
                        )}
                      </div>
                    </div>
                      <IconButton onClick={() => downloadFile(f)} title="Download file" className="primary compact">
                        {"\u2B07\uFE0F"}
                      </IconButton>
                      {f.ownerId === user.uid && (
                        <IconButton onClick={() => deleteFile(f)} title="Delete file" className="danger compact">
                          {"\u274C"}
                        </IconButton>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          <div className="editor-container" ref={editorContainerRef}>
            <div className="top-bar">
              <ThemeToggleButton darkMode={darkMode} onToggle={() => setDarkMode(!darkMode)} compact />
              <button className="logout-btn" onClick={logout} title="Logout">
                Logout
              </button>
            </div>
            <button
              className="sidebar-fab"
              onClick={() => setSidebarOpen((v) => !v)}
              title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
            >
              ☰
            </button>

            {currentFile ? (
              <>
                <div className="editor-header">
                  <h3>
                    Editing: {currentFile.name} {currentFile.projectId ? ` (project: ${currentFile.projectId})` : ""}
                  </h3>
                  <div className="save-dot" title={savedAt ? "Saved" : "Not saved"}>
                    <span className={`dot ${savedAt ? "ok" : ""}`} />
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={runCode}
                      disabled={currentFile?.language === "plaintext" || currentFile?.language === "css"}
                      title={currentFile?.language === "plaintext" || currentFile?.language === "css" ? "Cannot run this file type" : "Run code"}
                    >
                      Run Code
                    </button>
                    <IconButton
                      onClick={() => {
                        setShowChat((v) => {
                          const next = !v;
                          if (next && user && currentFile) {
                            const fileKey = fileKeyFor(currentFile);
                            const storageKey = `chatLastSeen:${fileKey}:${user.uid}`;
                            try {
                              localStorage.setItem(storageKey, String(Date.now()));
                            } catch {
                              // ignore storage errors
                            }
                            // local unread is no longer used; global badge handles it
                          }
                          return next;
                        });
                      }}
                      title={showChat ? "Hide conversation" : "Show conversation"}
                      className="primary compact"
                    >
                      <span className="chat-icon">
                        {"\u{1F4AC}"}
                        {globalUnreadCount > 0 && <span className="chat-badge">{globalUnreadCount}</span>}
                      </span>
                    </IconButton>
                  </div>
                </div>
                <div className="presence-bar">
                  <span className="presence-label">Viewing</span>
                  <span className="presence-count">{presenceUsers.length}</span>
                  {presenceUsers.length === 0 ? (
                    <span className="presence-empty">No active viewers</span>
                  ) : (
                    <div className="presence-list">
                      {presenceUsers.map((u) => (
                        <span key={u.uid} className="presence-chip" title={u.displayName}>
                          {u.photoURL ? (
                            <img className="presence-avatar" src={u.photoURL} alt={u.displayName} />
                          ) : (
                            <span className="presence-initial">{(u.displayName || "U").slice(0, 1).toUpperCase()}</span>
                          )}
                          <span className="presence-name">{u.displayName}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="editor-grow">
                  <Editor
                    height="100%"
                    language={currentFile.language === "plaintext" ? "text" : currentFile.language}
                    value={code}
                    onChange={(val) => saveFile(val ?? "")}
                    theme={darkMode ? "vs-dark" : "light"}
                    onMount={(editor, monaco) => {
                      editorRef.current = editor;
                      monacoRef.current = monaco;
                      const handler = editor.onDidChangeCursorSelection((e) => {
                        latestSelectionRef.current = {
                          startLineNumber: e.selection.startLineNumber,
                          startColumn: e.selection.startColumn,
                          endLineNumber: e.selection.endLineNumber,
                          endColumn: e.selection.endColumn,
                        };
                        if (presenceWriteTimerRef.current) clearTimeout(presenceWriteTimerRef.current);
                        presenceWriteTimerRef.current = setTimeout(() => {
                          if (user && currentFile) {
                            const fileKey = fileKeyFor(currentFile);
                            const presenceDoc = doc(db, "presence", fileKey, "users", user.uid);
                            setDoc(
                              presenceDoc,
                              {
                                uid: user.uid,
                                displayName: user.displayName || "Anonymous",
                                photoURL: user.photoURL || "",
                                fileName: currentFile.name,
                                projectId: currentFile.projectId || null,
                                selection: latestSelectionRef.current || null,
                                lastActive: serverTimestamp(),
                              },
                              { merge: true }
                            ).catch(() => {});
                          }
                        }, 300);
                      });
                      editor.onDidDispose(() => {
                        handler.dispose();
                      });
                    }}
                    options={{
                      automaticLayout: true,
                      quickSuggestions: true,             // basic completions
                      suggestOnTriggerCharacters: true,   // show suggestions when typing .
                      wordBasedSuggestions: true,         // complete from nearby words
                      tabCompletion: "on",
                      minimap: { enabled: false },
                      fontSize: 14,
                    }}
                  />
                </div>


                <div
                  className="resize-handle"
                  onMouseDown={() => {
                    isResizingRef.current = true;
                    document.body.style.cursor = "row-resize";
                    document.body.style.userSelect = "none";
                  }}
                  title="Drag to resize"
                />
                <div className="editor-bottom">
                  <div className="output-tabs">
                    <button
                      className={`tab-btn ${outputTab === "output" ? "active" : ""}`}
                      onClick={() => setOutputTab("output")}
                    >
                      Run Output
                    </button>
                    <button
                      className={`tab-btn ${outputTab === "console" ? "active" : ""}`}
                      onClick={() => setOutputTab("console")}
                    >
                      Console
                    </button>
                  </div>
                  <div className="output-box" style={{ height: outputHeight }}>
                    {outputTab === "output" ? (
                      <>
                        <h4>Output:</h4>
                        {currentFile.language === "html" ? <div id="html-output" /> : <pre>{output}</pre>}
                      </>
                    ) : (
                      <>
                        <h4>Console:</h4>
                        <pre>{consoleOutput || "No console output"}</pre>
                      </>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <p className="select-file-text">Select a file to start editing</p>
            )}
          </div>
          {currentFile && showChat && (
            <div className="chat-panel right">
              <div className="chat-header">Conversation</div>
              <div className="chat-messages">
                {chatMessages.length === 0 && <div className="chat-empty">No messages yet</div>}
                {chatMessages.map((m) => (
                  <div key={m.id} className={`chat-message ${m.uid === user?.uid ? "mine" : ""}`}>
                    <div className="chat-meta">{m.displayName || "Anonymous"}</div>
                    <div className="chat-text">{m.text}</div>
                  </div>
                ))}
                {typingUsers.length > 0 && (
                  <div className="chat-typing">
                    {typingUsers.join(", ")} typing…
                  </div>
                )}
              </div>
              <div className="chat-input">
                <input
                  type="text"
                  placeholder="Type a message..."
                  value={chatText}
                  onChange={(e) => {
                    setChatText(e.target.value);
                    setTyping(true);
                    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
                    typingTimerRef.current = setTimeout(() => setTyping(false), 1500);
                  }}
                  onBlur={() => setTyping(false)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") sendChat();
                  }}
                />
                <button onClick={sendChat}>Send</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
