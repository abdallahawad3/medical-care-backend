import type { Request, Response, NextFunction } from "express";
const asyncWrapper = (
  asyncFu: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    asyncFu(req, res, next).catch((e) => next(e));
  };
};

export default asyncWrapper;
