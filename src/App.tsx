import React, { useState, useEffect } from 'react';
import { Search, MapPin, Briefcase, Plus, User, LogOut, Menu, X, Building, DollarSign, Clock, Shield, Trash2, ExternalLink, Mail, AlertCircle, LayoutDashboard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { motion, AnimatePresence } from 'motion/react';
import { formatDistanceToNow } from 'date-fns';
import { id } from 'date-fns/locale';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from 'sonner';
import { JOB_CATEGORIES, JOB_TYPES } from '@/src/lib/constants';
import { UserProfile, JobListing } from './types';

// Firebase Imports
import { auth, db } from './lib/firebase';
import { 
  onAuthStateChanged, 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  signOut, 
  sendEmailVerification,
  updateProfile,
  signInWithPopup,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  User as FirebaseUser
} from 'firebase/auth';
import { 
  collection, 
  addDoc, 
  deleteDoc, 
  doc, 
  onSnapshot, 
  query, 
  orderBy, 
  setDoc, 
  getDoc,
  serverTimestamp,
  Timestamp,
  getDocFromServer,
  increment
} from 'firebase/firestore';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  // Surface a more readable error to the user if it's permission denied
  if (errInfo.error.includes('permission-denied') || errInfo.error.includes('insufficient permissions')) {
    toast.error("Akses ditolak. Pastikan Anda memiliki izin yang cukup.");
  } else {
    toast.error(`Kesalahan Database: ${errInfo.error}`);
  }
  throw new Error(JSON.stringify(errInfo));
}

export default function App() {
  const [jobs, setJobs] = useState<JobListing[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('Semua');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [isPostJobOpen, setIsPostJobOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdminView, setIsAdminView] = useState(false);
  const [selectedJob, setSelectedJob] = useState<JobListing | null>(null);
  const [visitorCount, setVisitorCount] = useState<number>(0);

  // Test Connection
  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
          toast.error("Koneksi Firebase gagal. Periksa konfigurasi.");
        }
      }
    }
    testConnection();
  }, []);

  // Auth State Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (fUser) => {
      setFirebaseUser(fUser);
      if (fUser) {
        try {
          // Fetch user profile from Firestore
          const userDoc = await getDoc(doc(db, 'users', fUser.uid));
          const isAdminEmail = fUser.email?.toLowerCase() === 'ahmadfauziwijaya92@gmail.com';
          
          if (userDoc.exists()) {
            const userData = userDoc.data() as UserProfile;
            // Force admin role if email matches but role is still 'user'
            if (isAdminEmail && userData.role !== 'admin') {
              const updatedUser = { ...userData, role: 'admin' as const };
              await setDoc(doc(db, 'users', fUser.uid), updatedUser);
              setUser(updatedUser);
            } else {
              setUser(userData);
            }
          } else {
            // If profile doesn't exist (e.g. first time login), create a basic one
            const newUser: UserProfile = {
              id: fUser.uid,
              name: fUser.displayName || 'User',
              email: fUser.email || '',
              role: isAdminEmail ? 'admin' : 'user'
            };
            await setDoc(doc(db, 'users', fUser.uid), newUser);
            setUser(newUser);
          }
        } catch (error) {
          console.error("Error fetching user profile:", error);
        }
      } else {
        setUser(null);
      }
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Real-time Jobs Listener
  useEffect(() => {
    const q = query(collection(db, 'jobs'), orderBy('postedAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const jobsData = snapshot.docs.map(doc => ({
        ...doc.data(),
        id: doc.id,
        postedAt: (doc.data().postedAt as Timestamp)?.toDate().toISOString() || new Date().toISOString()
      })) as JobListing[];
      setJobs(jobsData);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'jobs');
    });

    return () => unsubscribe();
  }, []);

  // Visitor Counter Logic
  useEffect(() => {
    const incrementVisitors = async () => {
      // Check if this is a new session
      const hasVisited = sessionStorage.getItem('hasVisited');
      if (!hasVisited) {
        try {
          const visitorRef = doc(db, 'stats', 'visitors');
          await setDoc(visitorRef, { count: increment(1) }, { merge: true });
          sessionStorage.setItem('hasVisited', 'true');
        } catch (error) {
          console.error("Error incrementing visitors:", error);
        }
      }
    };
    incrementVisitors();
  }, []);

  // Real-time Visitor Listener (Admin only)
  useEffect(() => {
    if (user?.role === 'admin') {
      const unsubscribe = onSnapshot(doc(db, 'stats', 'visitors'), (doc) => {
        if (doc.exists()) {
          setVisitorCount(doc.data().count || 0);
        }
      });
      return () => unsubscribe();
    }
  }, [user]);

  const handleGoogleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
      setIsAuthOpen(false);
      toast.success('Berhasil masuk dengan Google!');
    } catch (error: any) {
      console.error("Google Login Error:", error);
      toast.error(error.message || 'Gagal masuk dengan Google.');
    }
  };

  const handleRegister = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const name = formData.get('name') as string;
    const email = formData.get('email') as string;
    const password = formData.get('password') as string;

    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const fUser = userCredential.user;

      await updateProfile(fUser, { displayName: name });
      await sendEmailVerification(fUser);

      const newUser: UserProfile = {
        id: fUser.uid,
        name,
        email,
        role: email.toLowerCase() === 'ahmadfauziwijaya92@gmail.com' ? 'admin' : 'user'
      };
      
      try {
        await setDoc(doc(db, 'users', fUser.uid), newUser);
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `users/${fUser.uid}`);
      }
      
      setUser(newUser);
      setIsAuthOpen(false);
      toast.success(`Pendaftaran berhasil! Silakan cek email ${email} untuk verifikasi.`);
    } catch (error: any) {
      console.error("Registration Error:", error);
      if (error.code === 'auth/email-already-in-use') {
        toast.error('Email ini sudah terdaftar. Silakan gunakan menu "Masuk" atau reset password jika lupa.');
      } else if (error.code === 'auth/operation-not-allowed') {
        toast.error('Metode pendaftaran email/password belum diaktifkan di Firebase Console.');
      } else if (error.code === 'auth/weak-password') {
        toast.error('Password terlalu lemah. Gunakan minimal 6 karakter.');
      } else {
        toast.error(error.message || 'Pendaftaran gagal.');
      }
    }
  };

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const email = formData.get('email') as string;
    const password = formData.get('password') as string;

    try {
      await signInWithEmailAndPassword(auth, email, password);
      setIsAuthOpen(false);
      toast.success(`Selamat datang kembali!`);
    } catch (error: any) {
      console.error("Login Error:", error);
      if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
        toast.error('Email atau password salah. Silakan periksa kembali.');
      } else {
        toast.error(error.message || 'Gagal masuk.');
      }
    }
  };

  const handleForgotPassword = async () => {
    const email = prompt('Masukkan email Anda untuk reset password:');
    if (!email) return;

    try {
      await sendPasswordResetEmail(auth, email);
      toast.success(`Email reset password telah dikirim ke ${email}. Silakan cek kotak masuk Anda.`);
    } catch (error: any) {
      console.error("Reset Password Error:", error);
      toast.error(error.message || 'Gagal mengirim email reset password.');
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      toast.info('Anda telah keluar.');
    } catch (error) {
      toast.error('Gagal keluar.');
    }
  };

  const handleOpenPostJob = () => {
    if (!firebaseUser) {
      setIsAuthOpen(true);
      toast.error('Silakan masuk atau daftar terlebih dahulu untuk memasang lowongan.');
      return;
    }

    if (!firebaseUser.emailVerified && firebaseUser.email?.toLowerCase() !== 'ahmadfauziwijaya92@gmail.com') {
      toast.error('Silakan verifikasi email Anda terlebih dahulu.');
      return;
    }

    setIsPostJobOpen(true);
  };

  const handlePostJob = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user || !firebaseUser) return;

    const formData = new FormData(e.currentTarget);
    const jobData = {
      title: formData.get('title') as string,
      company: formData.get('company') as string,
      location: formData.get('location') as string,
      type: formData.get('type') as string,
      salary: formData.get('salary') as string,
      description: formData.get('description') as string,
      category: formData.get('category') as string,
      externalUrl: formData.get('externalUrl') as string || null,
      postedAt: serverTimestamp(),
      postedBy: user.name,
      authorUid: firebaseUser.uid
    };

    try {
      await addDoc(collection(db, 'jobs'), jobData);
      setIsPostJobOpen(false);
      toast.success('Lowongan kerja berhasil dipasang!');
    } catch (error: any) {
      console.error("Post Job Error:", error);
      toast.error('Gagal memasang lowongan. Pastikan data valid.');
    }
  };

  const handleDeleteJob = async (id: string) => {
    if (user?.role !== 'admin') return;
    try {
      await deleteDoc(doc(db, 'jobs', id));
      toast.success('Lowongan kerja berhasil dihapus.');
    } catch (error) {
      toast.error('Gagal menghapus lowongan.');
    }
  };

  const filteredJobs = jobs.filter(job => {
    const matchesSearch = job.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                         job.company.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === 'Semua' || job.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-zinc-900 border-t-transparent"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 font-sans text-zinc-900">
      {/* Verification Banner */}
      {firebaseUser && !firebaseUser.emailVerified && firebaseUser.email?.toLowerCase() !== 'ahmadfauziwijaya92@gmail.com' && (
        <div className="bg-amber-500 py-2 text-center text-xs font-bold text-white">
          <div className="mx-auto flex max-w-7xl items-center justify-center gap-2 px-4">
            <AlertCircle size={14} />
            Email Anda belum diverifikasi. Silakan cek kotak masuk Anda.
            <Button 
              variant="link" 
              size="sm" 
              className="h-auto p-0 text-xs text-white underline"
              onClick={async () => {
                try {
                  await sendEmailVerification(firebaseUser);
                  toast.success('Email verifikasi dikirim ulang. Silakan cek kotak masuk atau folder spam Anda.');
                } catch (error: any) {
                  console.error("Resend Verification Error:", error);
                  if (error.code === 'auth/too-many-requests') {
                    toast.error('Terlalu banyak permintaan. Silakan tunggu beberapa saat lagi.');
                  } else {
                    toast.error('Gagal mengirim ulang email verifikasi.');
                  }
                }
              }}
            >
              Kirim Ulang
            </Button>
          </div>
        </div>
      )}

      {isAdminView && user?.role === 'admin' && (
        <div className="bg-amber-500 py-1 text-center text-[10px] font-bold uppercase tracking-widest text-white">
          Anda sedang dalam Mode Administrator
        </div>
      )}
      {/* Navigation */}
      <nav className="sticky top-0 z-50 border-b border-zinc-200 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-900 text-white">
              <Briefcase size={24} />
            </div>
            <span className="text-xl font-bold tracking-tight">KarirHub</span>
          </div>

          {/* Desktop Nav */}
          <div className="hidden md:flex md:items-center md:gap-8">
            <a href="#" className="text-sm font-medium text-zinc-600 hover:text-zinc-900">Cari Kerja</a>
            <a href="#" className="text-sm font-medium text-zinc-600 hover:text-zinc-900">Perusahaan</a>
            <div className="h-6 w-px bg-zinc-200" />
            
            {user ? (
              <div className="flex items-center gap-4">
                {user.role === 'admin' && (
                  <Button 
                    variant={isAdminView ? "default" : "ghost"} 
                    size="sm"
                    className={`gap-2 rounded-full ${isAdminView ? 'bg-zinc-900 text-white' : 'text-zinc-500'}`}
                    onClick={() => setIsAdminView(!isAdminView)}
                  >
                    <LayoutDashboard size={16} />
                    <span className="hidden lg:inline">{isAdminView ? 'Lihat Web' : 'Dashboard Admin'}</span>
                  </Button>
                )}
                <div className="flex items-center gap-2">
                  <div className={`flex h-8 w-8 items-center justify-center rounded-full ${user.role === 'admin' ? 'bg-amber-100 text-amber-600' : 'bg-zinc-100 text-zinc-600'}`}>
                    {user.role === 'admin' ? <Shield size={16} /> : <User size={16} />}
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-bold leading-none">{user.name}</span>
                    <span className="text-[10px] text-zinc-500 uppercase tracking-wider">{user.role}</span>
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={handleLogout} className="text-zinc-500 hover:text-red-600">
                  <LogOut size={16} className="mr-2" />
                  Keluar
                </Button>
              </div>
            ) : (
              <Dialog open={isAuthOpen} onOpenChange={setIsAuthOpen}>
                <DialogTrigger render={<Button variant="ghost" size="sm" className="gap-2" />}>
                  <User size={18} />
                  Masuk / Daftar
                </DialogTrigger>
                <DialogContent className="sm:max-w-[425px]">
                  <Tabs defaultValue="login" className="w-full">
                    <TabsList className="grid w-full grid-cols-2">
                      <TabsTrigger value="login">Masuk</TabsTrigger>
                      <TabsTrigger value="register">Daftar</TabsTrigger>
                    </TabsList>
                    <TabsContent value="login">
                      <div className="space-y-4 pt-4">
                        <form onSubmit={handleLogin} className="space-y-4">
                          <div className="space-y-2">
                            <Label htmlFor="email">Email</Label>
                            <Input id="email" name="email" type="email" placeholder="email@contoh.com" required />
                          </div>
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <Label htmlFor="password">Password</Label>
                              <Button 
                                variant="link" 
                                size="sm" 
                                className="h-auto p-0 text-xs text-zinc-500"
                                onClick={handleForgotPassword}
                                type="button"
                              >
                                Lupa password?
                              </Button>
                            </div>
                            <Input id="password" name="password" type="password" placeholder="••••••••" required />
                          </div>
                          <Button type="submit" className="w-full">Masuk</Button>
                        </form>
                        <div className="relative">
                          <div className="absolute inset-0 flex items-center">
                            <span className="w-full border-t border-zinc-200" />
                          </div>
                          <div className="relative flex justify-center text-xs uppercase">
                            <span className="bg-white px-2 text-zinc-500">Atau</span>
                          </div>
                        </div>
                        <Button variant="outline" className="w-full gap-2" onClick={handleGoogleLogin}>
                          <svg className="h-4 w-4" viewBox="0 0 24 24">
                            <path
                              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                              fill="#4285F4"
                            />
                            <path
                              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                              fill="#34A853"
                            />
                            <path
                              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
                              fill="#FBBC05"
                            />
                            <path
                              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                              fill="#EA4335"
                            />
                          </svg>
                          Masuk dengan Google
                        </Button>
                      </div>
                    </TabsContent>
                    <TabsContent value="register">
                      <div className="space-y-4 pt-4">
                        <form onSubmit={handleRegister} className="space-y-4">
                          <div className="space-y-2">
                            <Label htmlFor="reg-name">Nama Lengkap</Label>
                            <Input id="reg-name" name="name" placeholder="Ahmad Fauzi" required />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="reg-email">Email</Label>
                            <Input id="reg-email" name="email" type="email" placeholder="ahmad@example.com" required />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="reg-password">Password</Label>
                            <Input id="reg-password" name="password" type="password" placeholder="••••••••" required />
                          </div>
                          <Button type="submit" className="w-full">Daftar Sekarang</Button>
                        </form>
                        <div className="relative">
                          <div className="absolute inset-0 flex items-center">
                            <span className="w-full border-t border-zinc-200" />
                          </div>
                          <div className="relative flex justify-center text-xs uppercase">
                            <span className="bg-white px-2 text-zinc-500">Atau</span>
                          </div>
                        </div>
                        <Button variant="outline" className="w-full gap-2" onClick={handleGoogleLogin}>
                          <svg className="h-4 w-4" viewBox="0 0 24 24">
                            <path
                              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                              fill="#4285F4"
                            />
                            <path
                              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                              fill="#34A853"
                            />
                            <path
                              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
                              fill="#FBBC05"
                            />
                            <path
                              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                              fill="#EA4335"
                            />
                          </svg>
                          Daftar dengan Google
                        </Button>
                        <p className="text-center text-[10px] text-zinc-400">
                          Dengan mendaftar, Anda akan menerima email verifikasi untuk mengaktifkan akun.
                        </p>
                      </div>
                    </TabsContent>
                  </Tabs>
                </DialogContent>
              </Dialog>
            )}

            <Dialog open={isPostJobOpen} onOpenChange={setIsPostJobOpen}>
              <Button 
                size="sm" 
                className="gap-2 rounded-full px-6"
                onClick={handleOpenPostJob}
              >
                <Plus size={18} />
                Pasang Lowongan
              </Button>
              <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[600px]">
                <form onSubmit={handlePostJob}>
                  <DialogHeader>
                    <DialogTitle>Pasang Lowongan Kerja</DialogTitle>
                    <DialogDescription>
                      Isi detail lowongan kerja yang ingin Anda bagikan.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-6 py-4">
                    <div className="grid gap-2">
                      <Label htmlFor="title">Judul Posisi</Label>
                      <Input id="title" name="title" placeholder="Contoh: Senior Backend Developer" required />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="grid gap-2">
                        <Label htmlFor="company">Nama Perusahaan</Label>
                        <Input id="company" name="company" placeholder="Contoh: PT Teknologi Maju" required />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="location">Lokasi</Label>
                        <Input id="location" name="location" placeholder="Contoh: Jakarta / Remote" required />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="grid gap-2">
                        <Label htmlFor="category">Kategori</Label>
                        <Select name="category" defaultValue="Teknologi">
                          <SelectTrigger>
                            <SelectValue placeholder="Pilih Kategori" />
                          </SelectTrigger>
                          <SelectContent>
                            {JOB_CATEGORIES.map(cat => (
                              <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="type">Tipe Pekerjaan</Label>
                        <Select name="type" defaultValue="Full-time">
                          <SelectTrigger>
                            <SelectValue placeholder="Pilih Tipe" />
                          </SelectTrigger>
                          <SelectContent>
                            {JOB_TYPES.map(type => (
                              <SelectItem key={type} value={type}>{type}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="salary">Estimasi Gaji (Opsional)</Label>
                      <Input id="salary" name="salary" placeholder="Contoh: Rp 10jt - 15jt" />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="externalUrl">Link Lowongan Asli (Opsional)</Label>
                      <Input id="externalUrl" name="externalUrl" type="url" placeholder="https://linkedin.com/jobs/..." />
                      <p className="text-[10px] text-zinc-400">Masukkan link jika lowongan ini berasal dari website lain untuk menghindari masalah hak cipta.</p>
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="description">Deskripsi Pekerjaan</Label>
                      <Textarea id="description" name="description" placeholder="Jelaskan tanggung jawab dan kualifikasi..." className="min-h-[100px]" required />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button type="submit" className="w-full">Pasang Sekarang</Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>

          {/* Mobile Menu Toggle */}
          <button 
            className="rounded-md p-2 text-zinc-600 md:hidden"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
          >
            {isMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>

        {/* Mobile Nav */}
        <AnimatePresence>
          {isMenuOpen && (
            <motion.div 
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="border-b border-zinc-200 bg-white md:hidden"
            >
              <div className="flex flex-col gap-4 p-4">
                <a href="#" className="text-lg font-medium">Cari Kerja</a>
                <a href="#" className="text-lg font-medium">Perusahaan</a>
                {user?.role === 'admin' && (
                  <Button 
                    variant={isAdminView ? "default" : "outline"} 
                    className="w-full justify-start gap-2"
                    onClick={() => {
                      setIsAdminView(!isAdminView);
                      setIsMenuOpen(false);
                    }}
                  >
                    <LayoutDashboard size={18} />
                    {isAdminView ? 'Lihat Website' : 'Dashboard Admin'}
                  </Button>
                )}
                {user ? (
                  <div className="flex items-center justify-between rounded-lg bg-zinc-50 p-3">
                    <div className="flex items-center gap-2">
                      <span className="font-bold">{user.name}</span>
                      <Badge variant="outline" className="text-[8px] uppercase">{user.role}</Badge>
                    </div>
                    <Button variant="ghost" size="sm" onClick={handleLogout} className="text-red-600">Keluar</Button>
                  </div>
                ) : (
                  <Button variant="outline" className="w-full justify-start gap-2" onClick={() => setIsAuthOpen(true)}>
                    <User size={18} />
                    Masuk / Daftar
                  </Button>
                )}
                <Button className="w-full justify-start gap-2" onClick={handleOpenPostJob}>
                  <Plus size={18} />
                  Pasang Lowongan
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </nav>

      <main className={isAdminView && user?.role === 'admin' ? 'bg-zinc-50' : ''}>
        {/* Hero Section */}
        {isAdminView && user?.role === 'admin' ? (
          <section className="relative overflow-hidden bg-zinc-900 py-16 text-white">
            <div className="absolute inset-0 opacity-10">
              <div className="absolute -left-20 -top-20 h-64 w-64 rounded-full bg-white blur-3xl" />
              <div className="absolute -right-20 -bottom-20 h-64 w-64 rounded-full bg-white blur-3xl" />
            </div>
            <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
              <div className="flex flex-col items-center justify-between gap-8 md:flex-row">
                <div className="max-w-2xl">
                  <Badge className="mb-4 bg-amber-500 text-white hover:bg-amber-600 border-none">Mode Administrator</Badge>
                  <h1 className="text-4xl font-black tracking-tight sm:text-6xl">
                    Panel Kendali <span className="text-amber-500">KarirHub</span>
                  </h1>
                  <p className="mt-6 text-lg text-zinc-400">
                    Selamat datang kembali, Admin. Pantau statistik, kelola lowongan, dan pastikan kualitas konten tetap terjaga untuk warga Medan.
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-4 w-full md:w-auto sm:grid-cols-3">
                  <div className="rounded-2xl bg-white/5 p-6 backdrop-blur-sm border border-white/10">
                    <div className="text-3xl font-bold text-amber-500">{jobs.length}</div>
                    <div className="text-xs text-zinc-500 uppercase tracking-widest mt-1">Total Lowongan</div>
                  </div>
                  <div className="rounded-2xl bg-white/5 p-6 backdrop-blur-sm border border-white/10">
                    <div className="text-3xl font-bold text-amber-500">{new Set(jobs.map(j => j.company)).size}</div>
                    <div className="text-xs text-zinc-500 uppercase tracking-widest mt-1">Perusahaan</div>
                  </div>
                  <div className="rounded-2xl bg-white/5 p-6 backdrop-blur-sm border border-white/10">
                    <div className="text-3xl font-bold text-amber-500">{visitorCount}</div>
                    <div className="text-xs text-zinc-500 uppercase tracking-widest mt-1">Total Kunjungan</div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        ) : (
          <section className="relative overflow-hidden bg-zinc-900 py-20 text-white sm:py-32">
            <div className="absolute inset-0 opacity-20">
              <div className="absolute -left-20 -top-20 h-96 w-96 rounded-full bg-zinc-500 blur-3xl" />
              <div className="absolute -right-20 -bottom-20 h-96 w-96 rounded-full bg-zinc-400 blur-3xl" />
            </div>
            
            <div className="relative mx-auto max-w-7xl px-4 text-center sm:px-6 lg:px-8">
              <motion.h1 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-4xl font-extrabold tracking-tight sm:text-6xl"
              >
                Temukan Karir Impianmu <br />
                <span className="text-zinc-400">Dimulai Dari Sini.</span>
              </motion.h1>
              <motion.p 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="mx-auto mt-6 max-w-2xl text-lg text-zinc-400"
              >
                Ribuan lowongan kerja dari perusahaan ternama menantimu. 
                Gunakan KarirHub untuk mempermudah pencarian kerjamu.
              </motion.p>

              {/* Search Bar */}
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="mx-auto mt-10 flex max-w-3xl flex-col gap-2 rounded-2xl bg-white p-2 shadow-2xl sm:flex-row sm:items-center"
              >
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={20} />
                  <Input 
                    placeholder="Cari posisi atau perusahaan..." 
                    className="border-none bg-transparent pl-10 text-zinc-900 focus-visible:ring-0"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
                <div className="hidden h-8 w-px bg-zinc-200 sm:block" />
                <div className="relative flex-1">
                  <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={20} />
                  <Input 
                    placeholder="Lokasi (Jakarta, Bandung...)" 
                    className="border-none bg-transparent pl-10 text-zinc-900 focus-visible:ring-0"
                  />
                </div>
                <Button className="rounded-xl px-8 py-6 text-lg font-bold">
                  Cari
                </Button>
              </motion.div>
            </div>
          </section>
        )}

        {/* Job Listings Section */}
        <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
            <div>
              <h2 className="text-3xl font-bold tracking-tight">Lowongan Terbaru</h2>
              <p className="mt-1 text-zinc-500">Menampilkan {filteredJobs.length} lowongan yang tersedia</p>
            </div>
            
            <div className="flex w-full flex-wrap gap-2 md:w-auto">
              {['Semua', ...JOB_CATEGORIES.slice(0, 4)].map((cat) => (
                <Button 
                  key={cat}
                  variant={selectedCategory === cat ? 'default' : 'outline'}
                  size="sm"
                  className="rounded-full"
                  onClick={() => setSelectedCategory(cat)}
                >
                  {cat}
                </Button>
              ))}
            </div>
          </div>

          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <AnimatePresence mode="popLayout">
              {filteredJobs.map((job) => (
                <motion.div
                  key={job.id}
                  layout
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  onClick={() => setSelectedJob(job)}
                >
                  <Card className="group h-full cursor-pointer border-zinc-200 transition-all hover:border-zinc-900 hover:shadow-xl">
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <Badge variant="secondary" className="bg-zinc-100 text-zinc-600">
                          {job.type}
                        </Badge>
                        <div className="flex items-center gap-2">
                          {isAdminView && (
                            <Badge variant="outline" className="border-amber-500 text-amber-600 bg-amber-50">
                              Admin Control
                            </Badge>
                          )}
                          <span className="text-xs text-zinc-400">
                            {formatDistanceToNow(new Date(job.postedAt), { addSuffix: true, locale: id })}
                          </span>
                          {user?.role === 'admin' && (
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="h-6 w-6 text-red-400 hover:bg-red-50 hover:text-red-600"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteJob(job.id);
                              }}
                            >
                              <Trash2 size={14} />
                            </Button>
                          )}
                        </div>
                      </div>
                      <CardTitle className="mt-4 text-xl group-hover:text-zinc-600">{job.title}</CardTitle>
                      <div className="flex items-center gap-2 text-sm font-medium text-zinc-500">
                        <Building size={14} />
                        {job.company}
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="flex flex-col gap-2 text-sm text-zinc-600">
                        <div className="flex items-center gap-2">
                          <MapPin size={16} className="text-zinc-400" />
                          {job.location}
                        </div>
                        <div className="flex items-center gap-2">
                          <Briefcase size={16} className="text-zinc-400" />
                          {job.category}
                        </div>
                        {job.salary && (
                          <div className="mt-2 flex items-center gap-2 font-bold text-zinc-900">
                            <DollarSign size={16} className="text-zinc-400" />
                            {job.salary}
                          </div>
                        )}
                      </div>
                      <p className="mt-4 line-clamp-2 text-sm text-zinc-500">
                        {job.description}
                      </p>
                    </CardContent>
                    <CardFooter className="flex flex-col gap-3 border-t border-zinc-100 pt-4">
                      {job.externalUrl ? (
                        <Button 
                          render={<a href={job.externalUrl} target="_blank" rel="noopener noreferrer" />}
                          variant="outline" 
                          className="w-full gap-2 border-zinc-900 text-zinc-900 hover:bg-zinc-900 hover:text-white"
                        >
                          Lihat Lowongan Asli
                          <ExternalLink size={14} />
                        </Button>
                      ) : (
                        <Button variant="ghost" className="w-full text-zinc-600 hover:bg-zinc-900 hover:text-white">
                          Lihat Detail
                        </Button>
                      )}
                    </CardFooter>
                  </Card>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>

          {/* Job Detail Dialog */}
          <Dialog open={!!selectedJob} onOpenChange={(open) => !open && setSelectedJob(null)}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[700px]">
              {selectedJob && (
                <>
                  <DialogHeader>
                    <div className="flex items-center gap-2 mb-2">
                      <Badge variant="secondary">{selectedJob.type}</Badge>
                      <Badge variant="outline">{selectedJob.category}</Badge>
                    </div>
                    <DialogTitle className="text-3xl font-black">{selectedJob.title}</DialogTitle>
                    <div className="flex items-center gap-2 text-lg font-medium text-zinc-600">
                      <Building size={18} />
                      {selectedJob.company}
                    </div>
                  </DialogHeader>
                  
                  <div className="grid gap-6 py-6">
                    <div className="flex flex-wrap gap-4 rounded-2xl bg-zinc-50 p-6">
                      <div className="flex items-center gap-2">
                        <MapPin size={20} className="text-zinc-400" />
                        <span className="font-medium">{selectedJob.location}</span>
                      </div>
                      {selectedJob.salary && (
                        <div className="flex items-center gap-2">
                          <DollarSign size={20} className="text-zinc-400" />
                          <span className="font-bold text-zinc-900">{selectedJob.salary}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <Clock size={20} className="text-zinc-400" />
                        <span>Dipasang {formatDistanceToNow(new Date(selectedJob.postedAt), { addSuffix: true, locale: id })}</span>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <h4 className="text-lg font-bold">Deskripsi Pekerjaan</h4>
                      <div className="whitespace-pre-wrap text-zinc-600 leading-relaxed">
                        {selectedJob.description}
                      </div>
                    </div>
                  </div>

                  <DialogFooter className="flex-col sm:flex-row gap-3">
                    {selectedJob.externalUrl ? (
                      <Button 
                        asChild
                        className="w-full sm:flex-1 gap-2 bg-zinc-900 py-6 text-lg"
                      >
                        <a href={selectedJob.externalUrl} target="_blank" rel="noopener noreferrer">
                          Lamar Sekarang
                          <ExternalLink size={18} />
                        </a>
                      </Button>
                    ) : (
                      <Button className="w-full sm:flex-1 py-6 text-lg bg-zinc-900">
                        Lamar Pekerjaan Ini
                      </Button>
                    )}
                    <Button 
                      variant="outline" 
                      className="w-full sm:w-auto py-6"
                      onClick={() => setSelectedJob(null)}
                    >
                      Tutup
                    </Button>
                  </DialogFooter>
                </>
              )}
            </DialogContent>
          </Dialog>

          {filteredJobs.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-zinc-100 text-zinc-400">
                <Search size={40} />
              </div>
              <h3 className="text-xl font-bold">Tidak ada lowongan ditemukan</h3>
              <p className="text-zinc-500">Coba gunakan kata kunci lain atau pilih kategori yang berbeda.</p>
              <Button 
                variant="link" 
                className="mt-4"
                onClick={() => {
                  setSearchQuery('');
                  setSelectedCategory('Semua');
                }}
              >
                Reset Pencarian
              </Button>
            </div>
          )}
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-200 bg-white py-12">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col items-center justify-between gap-6 md:flex-row">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-900 text-white">
                <Briefcase size={18} />
              </div>
              <span className="text-lg font-bold tracking-tight">KarirHub</span>
            </div>
            <p className="text-sm text-zinc-500">
              © 2026 KarirHub. Dibuat untuk mempermudah masa depanmu.
            </p>
            <div className="flex gap-6">
              <a href="#" className="text-sm text-zinc-500 hover:text-zinc-900">Tentang Kami</a>
              <a href="#" className="text-sm text-zinc-500 hover:text-zinc-900">Kebijakan Privasi</a>
              <a href="#" className="text-sm text-zinc-500 hover:text-zinc-900">Kontak</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
