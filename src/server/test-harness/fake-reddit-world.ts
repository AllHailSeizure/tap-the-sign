import { vi } from 'vitest';
import { reddit, type Comment, type CommentSubmissionOptions } from '@devvit/web/server';
import type { T1, T3 } from '@devvit/web/shared';
import type { DevvitFixtures } from '@devvit/test/server/vitest';

export interface FakeCommentRecord {
  id: T1;
  parentId: T1 | T3;
  postId: T3;
  body: string;
  authorName: string;
  removed: boolean;
  locked: boolean;
  distinguished: boolean;
  stickied: boolean;
}

export interface FakePostRecord {
  id: T3;
  title: string;
  selftext?: string;
  authorId?: string;
  removed: boolean;
}

export type WorldExtension = (world: FakeRedditWorld, mocks: DevvitFixtures['mocks']) => void;

/**
 * Minimal stateful in-memory Reddit world layered on top of `@devvit/test`.
 *
 * `@devvit/test` handles isolated Redis, Settings, Scheduler, Context, and partial
 * Users/LinksAndComments mocks. `FakeRedditWorld` intercepts unimplemented
 * Moderation/Listing/Flair calls (`submitComment`, `remove`, etc.) and tracks mutations
 * without logging in to Reddit.
 *
 * Expand via `world.use(...)` (or add methods here as moderation modules need them).
 */
export class FakeRedditWorld {
  readonly posts = new Map<string, FakePostRecord>();
  readonly comments: FakeCommentRecord[] = [];
  readonly removedIds = new Set<string>();
  private nextCommentSeq = 1;

  constructor(private readonly mocks: DevvitFixtures['mocks']) {}

  seedPost(post: { id: T3; title: string; selftext?: string; authorId?: string }): FakePostRecord {
    const record: FakePostRecord = {
      id: post.id,
      title: post.title,
      selftext: post.selftext,
      authorId: post.authorId,
      removed: false,
    };
    this.posts.set(post.id, record);
    this.mocks.reddit.linksAndComments.addPost({
      id: post.id,
      title: post.title,
      selftext: post.selftext,
    });
    return record;
  }

  commentsOn(parentId: T1 | T3): FakeCommentRecord[] {
    return this.comments.filter((c) => c.parentId === parentId);
  }

  isRemoved(id: string): boolean {
    return this.removedIds.has(id);
  }

  /**
   * Extension point for app-specific or future Phase 4 Reddit API mocks
   * (e.g., `getComments`, `getPostsByUser`, `getModerators`, `setUserFlair`).
   */
  use(extension: WorldExtension): this {
    extension(this, this.mocks);
    return this;
  }

  installDefaultSpies(): void {
    vi.spyOn(reddit, 'submitComment').mockImplementation(
      async (options: CommentSubmissionOptions & { id: T1 | T3 }): Promise<Comment> => {
        const id = `t1_mock_${this.nextCommentSeq++}` as T1;
        const postId = (
          options.id.startsWith('t3_')
            ? options.id
            : (this.comments.find((c) => c.id === options.id)?.postId ?? 't3_unknown')
        ) as T3;

        const record: FakeCommentRecord = {
          id,
          parentId: options.id,
          postId,
          body: 'text' in options ? options.text : JSON.stringify(options.richtext),
          authorName: 'test-app',
          removed: false,
          locked: false,
          distinguished: false,
          stickied: false,
        };
        this.comments.push(record);

        const commentStub = {
          id,
          body: record.body,
          parentId: record.parentId,
          postId: record.postId,
          authorName: record.authorName,
          lock: vi.fn(async () => {
            record.locked = true;
          }),
          distinguish: vi.fn(async (sticky?: boolean) => {
            record.distinguished = true;
            if (sticky) record.stickied = true;
          }),
        };
        return commentStub as unknown as Comment;
      }
    );

    vi.spyOn(reddit, 'remove').mockImplementation(
      async (id: T1 | T3, _isSpam: boolean): Promise<void> => {
        this.removedIds.add(id);
        const post = this.posts.get(id);
        if (post) post.removed = true;
        const comment = this.comments.find((c) => c.id === id);
        if (comment) comment.removed = true;
      }
    );
  }
}
