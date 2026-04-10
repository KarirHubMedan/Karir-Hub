export interface JobListing {
  id: string;
  title: string;
  company: string;
  location: string;
  type: 'Full-time' | 'Part-time' | 'Contract' | 'Remote' | 'Internship';
  salary?: string;
  description: string;
  requirements?: string[];
  postedBy: string; // User UID
  postedAt: any; // Firestore Timestamp
  category: string;
  externalUrl?: string;
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  password?: string; // For simulation only
  role: 'user' | 'admin';
}
