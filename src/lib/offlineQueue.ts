import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, setDoc, Firestore } from 'firebase/firestore';

const QUEUE_KEY = 'gps_offline_queue';

interface QueuedUpdate {
  docPath: string;
  data: object;
}

export async function enqueueUpdate(data: QueuedUpdate): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    const queue: QueuedUpdate[] = raw ? JSON.parse(raw) : [];
    queue.push(data);
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch (error) {
    console.error('[offlineQueue] enqueueUpdate error:', error);
  }
}

export async function flushQueue(db: Firestore): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    if (!raw) return;

    const queue: QueuedUpdate[] = JSON.parse(raw);
    if (queue.length === 0) return;

    const failed: QueuedUpdate[] = [];

    for (const item of queue) {
      try {
        const parts = item.docPath.split('/');
        // Reconstruct document reference from path segments
        // Firestore paths alternate collection/doc/collection/doc…
        if (parts.length < 2 || parts.length % 2 !== 0) {
          console.warn('[offlineQueue] Invalid docPath:', item.docPath);
          continue;
        }
        // Build the doc reference dynamically
        const docRef = doc(db, parts[0], parts[1], ...parts.slice(2));
        await setDoc(docRef, item.data, { merge: true });
      } catch (err) {
        console.warn('[offlineQueue] Failed to flush item:', item.docPath, err);
        failed.push(item);
      }
    }

    if (failed.length > 0) {
      await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(failed));
    } else {
      await AsyncStorage.removeItem(QUEUE_KEY);
    }
  } catch (error) {
    console.error('[offlineQueue] flushQueue error:', error);
  }
}
