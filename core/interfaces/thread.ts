type CreateThreadDTO = {
  title: string;
  author_id: string;
  author_username: string;
};

type PaginationDTO = {
  skip: number;
  take: number;
};

export type { CreateThreadDTO, PaginationDTO };
